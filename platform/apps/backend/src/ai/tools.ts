/**
 * Audited AI tool layer (Level 3 §1.2, §6). A model never calls these directly:
 * task code turns validated model output into tool calls, and every call passes
 * the same gate:
 *
 *   tenant selector scan → strict input schema → max automatic risk →
 *   permission → per-task tool-call budget (fenced by the task lease) →
 *   AIAction row keyed by idempotency key (completed calls replay, never re-run).
 *
 * The StoreEnvironment comes only from the server-built ExecutionContext.
 */
import { createHash } from "crypto"
import { z } from "zod"
import { generateEntityId, MedusaError, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { STOREFRONT_CORE_VERSION } from "@platform/storefront-core"
import { DEFAULT_THEME, parseStorefrontConfig, StorefrontConfigError } from "@platform/storefront-schema"
import { AI_MODULE } from "../modules/ai"
import type AiModuleService from "../modules/ai/service"
import { STOREFRONT_MODULE } from "../modules/storefront"
import type StorefrontModuleService from "../modules/storefront/service"
import { requestPreviewDeployment } from "../storefront/deployments"
import { ExecutionContext, Permission, requirePermission } from "../tenancy/context"
import { findTenantSelectors, isForbiddenTenantKey } from "../tenancy/selectors"
import { AiLimits, aiLimits } from "./config"
import { LeaseLostError, LimitReachedError, ToolRejectedError } from "./errors"
import { BrandProposalSchema, HomeCopySchema, OfferSuggestionSchema, priceStatedByMerchant } from "./schemas"
import { sqlRows } from "./sql"

export type ToolRuntime = {
  ctx: ExecutionContext
  runId: string
  taskId: string
  leaseToken: string
  actor: { user_id: string; provider: string | null; model: string | null }
  /** Merchant-authored text (description + typed facts), used by fact guards. */
  merchantText: string
  /** Limits captured on the run at start; falls back to current server configuration. */
  limits?: AiLimits
}

export type AiTool<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string
  risk: 0 | 1 | 2 | 3
  permission: Permission
  input: S
  handler: (rt: ToolRuntime, input: z.output<S>, idempotencyKey: string) => Promise<Record<string, unknown>>
}

function defineAiTool<S extends z.ZodObject<any>>(tool: AiTool<S>): AiTool<S> {
  const forbidden = Object.keys(tool.input.shape).filter(isForbiddenTenantKey)
  if (forbidden.length) {
    throw new Error(`AI tool ${tool.name} declares tenant-selecting input: ${forbidden.join(", ")}`)
  }
  return tool
}

const canonical = (value: unknown) => JSON.stringify(value, Object.keys(value ?? {}).sort())
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

const ai = (rt: ToolRuntime): AiModuleService => rt.ctx.scope.container.resolve(AI_MODULE)
const storefrontService = (rt: ToolRuntime): StorefrontModuleService => rt.ctx.scope.container.resolve(STOREFRONT_MODULE)

async function findGeneration(rt: ToolRuntime, kind: string, idempotencyKey: string) {
  const [row] = (await ai(rt).listGenerations({
    idempotency_key: idempotencyKey,
    kind: kind as any,
    store_environment_id: rt.ctx.scope.storeEnvironmentId,
  } as any)) as any[]
  return row ?? null
}

async function activeProject(rt: ToolRuntime) {
  const [project] = (await storefrontService(rt).listStorefrontProjects({
    store_environment_id: rt.ctx.scope.storeEnvironmentId,
    status: "active",
  })) as any[]
  if (!project) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "storefront project not found")
  }
  return project
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const businessProfileUpsert = defineAiTool({
  name: "business_profile.upsert",
  risk: 0,
  permission: "ai:generate",
  input: z.strictObject({
    description: z.string().min(1).max(4000),
    facts: z.record(z.string(), z.unknown()),
  }),
  handler: async (rt, input) => {
    const service = ai(rt)
    const env = rt.ctx.scope.storeEnvironmentId
    const [existing] = (await service.listBusinessProfiles({ store_environment_id: env })) as any[]
    const profile = existing
      ? await service.updateBusinessProfiles({ id: existing.id, description: input.description, facts: input.facts } as any)
      : await service.createBusinessProfiles({ store_environment_id: env, description: input.description, facts: input.facts } as any)
    return { business_profile_id: (profile as any).id }
  },
})

const brandApply = defineAiTool({
  name: "brand.apply",
  risk: 0,
  permission: "ai:generate",
  input: BrandProposalSchema,
  handler: async (rt, input, key) => {
    const project = await activeProject(rt)
    const current = parseStorefrontConfig(project.config)
    let themeSource: "model" | "platform_default" = "model"
    let config
    try {
      config = parseStorefrontConfig({
        ...current,
        theme: { preset: "default", typography: input.typography, corner: input.corner, colors: input.colors },
      })
    } catch {
      // Unreadable palette: keep the model's typography/corner, use the validated platform colours.
      themeSource = "platform_default"
      config = parseStorefrontConfig({
        ...current,
        theme: { ...DEFAULT_THEME, typography: input.typography, corner: input.corner },
      })
    }
    await storefrontService(rt).updateStorefrontProjects({
      id: project.id,
      config,
      core_version: STOREFRONT_CORE_VERSION,
    } as any)
    const service = ai(rt)
    const env = rt.ctx.scope.storeEnvironmentId
    const [profile] = (await service.listBusinessProfiles({ store_environment_id: env })) as any[]
    const brand = { tagline: input.tagline, tone: input.tone, theme_source: themeSource }
    if (profile) {
      await service.updateBusinessProfiles({ id: profile.id, brand } as any)
    } else {
      await service.createBusinessProfiles({ store_environment_id: env, brand } as any)
    }
    let generation = await findGeneration(rt, "brand", key)
    generation ??= await service.createGenerations({
      store_environment_id: env,
      run_id: rt.runId,
      idempotency_key: key,
      task_id: rt.taskId,
      kind: "brand",
      status: "applied",
      payload: { idempotency_key: key, ...brand, theme: config.theme },
      provenance: {
        tagline: "ai_inference",
        tone: "ai_inference",
        typography: "ai_inference",
        colors: themeSource === "model" ? "ai_inference" : "platform_default",
      },
    } as any)
    return { generation_id: generation.id, theme_source: themeSource }
  },
})

const createProductDraft = defineAiTool({
  name: "catalogue.create_product_draft",
  risk: 1,
  permission: "catalogue:write",
  input: z.strictObject({
    title: z.string().min(1).max(80),
    title_source: z.enum(["merchant_fact", "ai_inference"]),
    description: z.string().max(600),
    description_source: z.enum(["merchant_fact", "ai_inference"]),
    merchant_price_eur: z.number().positive().max(100000).nullable(),
  }),
  handler: async (rt, input, key) => {
    if (input.merchant_price_eur !== null && !priceStatedByMerchant(input.merchant_price_eur, rt.merchantText)) {
      throw new ToolRejectedError("policy", "price was not stated by the merchant")
    }
    const container = rt.ctx.scope.container
    const service = ai(rt)
    const env = rt.ctx.scope.storeEnvironmentId

    let generation = await findGeneration(rt, "product_draft", key)
    if (!generation) {
      const drafts = (await service.listGenerations(
        { run_id: rt.runId, kind: "product_draft", store_environment_id: env },
        { take: null }
      )) as any[]
      if (drafts.length >= (rt.limits ?? aiLimits()).maxProductDrafts) {
        throw new LimitReachedError("maximum product drafts for this run")
      }
      generation = await service.createGenerations({
        store_environment_id: env,
        run_id: rt.runId,
      idempotency_key: key,
        task_id: rt.taskId,
        kind: "product_draft",
        status: "proposed",
        payload: {
          idempotency_key: key,
          title: input.title,
          description: input.description,
          merchant_price_eur: input.merchant_price_eur,
        },
        provenance: {
          title: input.title_source,
          description: input.description_source,
          price: input.merchant_price_eur === null ? null : "merchant_fact",
          stock: null,
          status: "draft_until_merchant_confirmation",
        },
      } as any)
    }

    // Deterministic handle makes creation idempotent even if we crashed after creating the product.
    const handle = `ai-${String(generation.id).toLowerCase().replace(/_/g, "-")}`
    const productModule = container.resolve(Modules.PRODUCT)
    let [product] = (await productModule.listProducts({ handle }, { select: ["id", "status"] })) as any[]
    if (!product) {
      const [salesChannelId] = await rt.ctx.scope.ownedIds("sales_channel")
      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: input.title,
              description: input.description || null,
              handle,
              status: "draft",
              options: [{ title: "Вариант", values: ["Стандартен"] }],
              variants: [
                {
                  title: "Стандартен",
                  options: { "Вариант": "Стандартен" },
                  manage_inventory: false,
                  prices:
                    input.merchant_price_eur === null
                      ? []
                      : [{ amount: input.merchant_price_eur, currency_code: "eur" }],
                },
              ],
              sales_channels: salesChannelId ? [{ id: salesChannelId }] : [],
              metadata: {
                ai: { generation_id: generation.id, run_id: rt.runId, provenance: generation.provenance },
              },
            } as any,
          ],
        },
      })
      product = result[0]
    }
    await rt.ctx.scope.claim("product", [product.id])
    if (generation.resource_id !== product.id) {
      await service.updateGenerations({ id: generation.id, resource_type: "product", resource_id: product.id } as any)
    }
    return { product_id: product.id, generation_id: generation.id, status: "draft" }
  },
})

const attachProductImage = defineAiTool({
  name: "media.attach_product_image",
  risk: 1,
  permission: "catalogue:write",
  input: z.strictObject({
    media_asset_id: z.string().regex(/^media_[0-9A-Z]{26}$/),
    product_id: z.string().regex(/^prod_[0-9A-Z]{26}$/),
    pairing: z.enum(["position_inference", "merchant_specified"]),
  }),
  handler: async (rt, input, key) => {
    const container = rt.ctx.scope.container
    const env = rt.ctx.scope.storeEnvironmentId
    const [asset] = (await ai(rt).listMediaAssets({ id: input.media_asset_id, store_environment_id: env })) as any[]
    if (!asset) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "media asset not found")
    }
    await rt.ctx.scope.assertOwned("media_file", asset.file_id)
    await rt.ctx.scope.assertOwned("product", input.product_id)
    const productModule = container.resolve(Modules.PRODUCT)
    const product: any = await productModule.retrieveProduct(input.product_id, { relations: ["images"] })
    if (product.status !== "draft" || !product.metadata?.ai) {
      throw new ToolRejectedError("policy", "images can only be attached to AI product drafts")
    }
    const urls = (product.images ?? []).map((i: any) => i.url)
    if (!urls.includes(asset.url)) {
      await updateProductsWorkflow(container).run({
        input: {
          selector: { id: product.id },
          update: {
            images: [...urls.map((url: string) => ({ url })), { url: asset.url }],
            thumbnail: product.thumbnail ?? asset.url,
          },
        } as any,
      })
    }
    if (!(await findGeneration(rt, "image_attachment", key))) {
      await ai(rt).createGenerations({
        store_environment_id: env,
        run_id: rt.runId,
      idempotency_key: key,
        task_id: rt.taskId,
        kind: "image_attachment",
        status: "applied",
        payload: { idempotency_key: key, media_asset_id: asset.id, product_id: product.id },
        provenance: { image: "merchant_upload", pairing: input.pairing },
        resource_type: "product",
        resource_id: product.id,
      } as any)
    }
    return { product_id: product.id, media_asset_id: asset.id }
  },
})

const storefrontUpdateHome = defineAiTool({
  name: "storefront.update_home",
  risk: 0,
  permission: "ai:generate",
  input: HomeCopySchema,
  handler: async (rt, input, key) => {
    const project = await activeProject(rt)
    const current = parseStorefrontConfig(project.config)
    const config = parseStorefrontConfig({
      ...current,
      home: {
        hero: {
          headline: input.hero_headline,
          subheadline: input.hero_subheadline,
          cta_label: current.home.hero.cta_label,
        },
        product_grid: current.home.product_grid,
        about: { title: input.about_title, body: input.about_body },
      },
    })
    await storefrontService(rt).updateStorefrontProjects({
      id: project.id,
      config,
      core_version: STOREFRONT_CORE_VERSION,
    } as any)
    let generation = await findGeneration(rt, "storefront_config", key)
    generation ??= await ai(rt).createGenerations({
      store_environment_id: rt.ctx.scope.storeEnvironmentId,
      run_id: rt.runId,
      idempotency_key: key,
      task_id: rt.taskId,
      kind: "storefront_config",
      status: "applied",
      payload: { idempotency_key: key, home: config.home },
      provenance: { hero: "ai_inference", about: "ai_inference", preview_only: true },
      resource_type: "storefront_project",
      resource_id: project.id,
    } as any)
    return { generation_id: generation.id, project_id: project.id }
  },
})

const storefrontRequestPreview = defineAiTool({
  name: "storefront.request_preview_deployment",
  risk: 1,
  permission: "storefront:deploy",
  input: z.strictObject({}),
  handler: async (rt, _input, key) => {
    const deployment = await requestPreviewDeployment(rt.ctx.scope.container, rt.ctx.scope.storeEnvironmentId, {
      requestKey: key,
    })
    return { deployment_id: deployment.id, status: deployment.status }
  },
})

const offersPropose = defineAiTool({
  name: "offers.propose",
  risk: 0,
  permission: "ai:generate",
  input: z.strictObject({ offer: OfferSuggestionSchema }),
  handler: async (rt, input, key) => {
    let generation = await findGeneration(rt, "offer_suggestion", key)
    generation ??= await ai(rt).createGenerations({
      store_environment_id: rt.ctx.scope.storeEnvironmentId,
      run_id: rt.runId,
      idempotency_key: key,
      task_id: rt.taskId,
      kind: "offer_suggestion",
      status: "proposed",
      payload: { idempotency_key: key, ...input.offer },
      provenance: { offer: "recommendation", applied: false },
    } as any)
    return { generation_id: generation.id, applied: false }
  },
})

export const AI_TOOLS = {
  [businessProfileUpsert.name]: businessProfileUpsert,
  [brandApply.name]: brandApply,
  [createProductDraft.name]: createProductDraft,
  [attachProductImage.name]: attachProductImage,
  [storefrontUpdateHome.name]: storefrontUpdateHome,
  [storefrontRequestPreview.name]: storefrontRequestPreview,
  [offersPropose.name]: offersPropose,
} as Record<string, AiTool>

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeAiTool(
  rt: ToolRuntime,
  toolName: string,
  rawArgs: unknown,
  idempotencyKey: string
): Promise<Record<string, unknown>> {
  if (!rt.ctx?.scope) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "AI tools require a server ExecutionContext")
  }
  const tool = AI_TOOLS[toolName]
  if (!tool) {
    throw new ToolRejectedError("invalid_input", `unknown tool ${toolName}`)
  }
  if (findTenantSelectors(rawArgs).length) {
    throw new ToolRejectedError("tenant_selector", `${toolName} arguments must not select a tenant`)
  }
  const parsed = tool.input.safeParse(rawArgs)
  if (!parsed.success) {
    throw new ToolRejectedError(
      "invalid_input",
      parsed.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).join("; ")
    )
  }
  const limits = rt.limits ?? aiLimits()
  if (tool.risk > limits.maxAutoRisk) {
    throw new ToolRejectedError("risk", `${toolName} (risk ${tool.risk}) needs merchant confirmation`)
  }
  requirePermission(rt.ctx, tool.permission)

  const container = rt.ctx.scope.container
  const env = rt.ctx.scope.storeEnvironmentId
  const key = `${rt.runId}:${idempotencyKey}`

  // Replay: a completed call with this key never runs again (and never counts again).
  const [existing] = await sqlRows(
    container,
    `SELECT id, status, result, store_environment_id FROM ai_action WHERE idempotency_key = ? AND deleted_at IS NULL`,
    [key]
  )
  if (existing && existing.store_environment_id !== env) {
    throw new ToolRejectedError("policy", "idempotency key belongs to another store environment")
  }
  if (existing?.status === "succeeded") {
    return { ...(existing.result ?? {}), replayed: true }
  }

  // Per-task budget, fenced by the lease: a worker that lost its lease cannot act.
  const counted = await sqlRows(
    container,
    `UPDATE ai_task SET tool_calls = tool_calls + 1, updated_at = now()
     WHERE id = ? AND lease_token = ? AND status = 'running' AND tool_calls < ?
     RETURNING tool_calls`,
    [rt.taskId, rt.leaseToken, limits.maxToolCallsPerTask]
  )
  if (!counted.length) {
    const [task] = await sqlRows(container, `SELECT lease_token, status, tool_calls FROM ai_task WHERE id = ?`, [rt.taskId])
    if (!task || task.lease_token !== rt.leaseToken || task.status !== "running") {
      throw new LeaseLostError()
    }
    throw new LimitReachedError("maximum tool calls for this task")
  }

  const input = parsed.data
  let actionId: string = existing?.id
  if (existing) {
    await sqlRows(
      container,
      `UPDATE ai_action SET status = 'started', error = NULL, started_at = now(), updated_at = now() WHERE id = ?`,
      [existing.id]
    )
  } else {
    const inserted = await sqlRows(
      container,
      `INSERT INTO ai_action
         (id, store_environment_id, run_id, task_id, tool, risk, idempotency_key, status, input, input_hash, actor, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?::jsonb, ?, ?::jsonb, now(), now(), now())
       ON CONFLICT (idempotency_key) WHERE deleted_at IS NULL DO NOTHING
       RETURNING id`,
      [
        generateEntityId(undefined, "aact"),
        env,
        rt.runId,
        rt.taskId,
        tool.name,
        tool.risk,
        key,
        JSON.stringify(input),
        sha256(canonical(input)),
        JSON.stringify({ ...rt.actor, run_id: rt.runId, task_id: rt.taskId }),
      ]
    )
    if (!inserted.length) {
      // Lost an insert race to another holder of the same key: let the task retry and replay.
      throw new LeaseLostError()
    }
    actionId = inserted[0].id
  }

  try {
    // Handlers receive the run-scoped key, so resource lookups (generations, deployments) never collide across runs.
    const result = await tool.handler(rt, input, key)
    await sqlRows(
      container,
      `UPDATE ai_action SET status = 'succeeded', result = ?::jsonb, finished_at = now(), updated_at = now() WHERE id = ?`,
      [JSON.stringify(result), actionId]
    )
    return result
  } catch (error: any) {
    await sqlRows(
      container,
      `UPDATE ai_action SET status = 'failed', error = ?, finished_at = now(), updated_at = now() WHERE id = ?`,
      [String(error?.message ?? error).slice(0, 2000), actionId]
    )
    if (error instanceof StorefrontConfigError) {
      // Output that fails the storefront contract is a rejection, never worth retrying.
      throw new ToolRejectedError("invalid_input", error.message)
    }
    throw error
  }
}
