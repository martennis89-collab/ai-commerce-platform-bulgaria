/**
 * Initial generation tasks. Each task is deterministic orchestration code: the
 * model only fills strict schemas; every persistent effect is an audited tool
 * call with a stable idempotency key, so re-running a task after a crash or a
 * retry replays completed calls instead of duplicating anything.
 */
import type { TaskKey } from "../modules/ai/models"
import { parseStorefrontConfig, resolveElement } from "@platform/storefront-schema"
import { activeProjectFor, ensureHeadRevision } from "../storefront/revisions"
import { sqlRows } from "./sql"
import { dataPrompt, systemPrompt } from "./prompts"
import {
  BrandProposalSchema,
  DesignerPlanSchema,
  DraftCopySchema,
  FactsExtractionSchema,
  HomeCopySchema,
  OffersSchema,
  priceStatedByMerchant,
} from "./schemas"
import type { StartGenerationInput } from "./runs"
import type { TaskRuntime } from "./worker"

type TaskImplementation = (rt: TaskRuntime) => Promise<Record<string, unknown>>

const storeNameOf = (rt: TaskRuntime) =>
  (rt.input.facts?.business_name ?? rt.ctx.store_environment.name).slice(0, 80)

const withInstruction = (rt: TaskRuntime) => (rt.task.instruction ? { instruction: rt.task.instruction } : {})

const brand: TaskImplementation = async (rt) => {
  await rt.step("Предлагане на визуална идентичност", 10)
  const input = rt.input
  const proposal = await rt.model({
    purpose: "generation",
    operation: "brand.generate",
    schema: BrandProposalSchema,
    input: { store_name: storeNameOf(rt), description: input.description, facts: input.facts ?? {}, ...withInstruction(rt) },
    task: "Propose the brand for this store.",
  })
  await rt.step("Запазване на профила", 50)
  await rt.tool("business_profile.upsert", { description: input.description, facts: input.facts ?? {} }, "profile")
  await rt.step("Прилагане на темата", 75)
  const applied = await rt.tool("brand.apply", proposal, `brand${rt.task.instruction ? `:${rt.task.id}` : ""}`)
  return { theme_source: applied.theme_source, tagline: proposal.tagline }
}

const catalogue: TaskImplementation = async (rt) => {
  await rt.step("Извличане на факти за продуктите", 10)
  const input = rt.input
  const extracted = await rt.model({
    purpose: "extraction",
    operation: "facts.extract",
    schema: FactsExtractionSchema,
    input: { description: input.description, facts: input.facts ?? {} },
    task: "Extract the merchant's explicitly stated facts.",
  })

  // Merchant-typed products are authoritative; extracted ones fill in, de-duplicated by name.
  const typed = (input.facts?.products ?? []).map((p) => ({
    name: p.name,
    price: p.price_eur ?? null,
    details: p.description ?? null,
    typed: true,
  }))
  const seen = new Set(typed.map((p) => p.name.toLowerCase()))
  const fromText = extracted.products
    .filter((p) => !seen.has(p.name.toLowerCase()))
    .map((p) => ({ name: p.name, price: p.stated_price_eur, details: p.stated_details, typed: false }))
  const products = [...typed, ...fromText].slice(0, rt.limits.maxProductDrafts)
  if (!products.length) {
    return { product_ids: [], note: "no products stated" }
  }

  await rt.step("Подготовка на чернови", 35)
  const copy = await rt.model({
    purpose: "generation",
    operation: "catalogue.draft_copy",
    schema: DraftCopySchema,
    input: { description: input.description, products: products.map((p) => ({ name: p.name, details: p.details })), ...withInstruction(rt) },
    task: "Write draft titles and descriptions for these products.",
  })

  const productIds: string[] = []
  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    const draft = copy.drafts.find((d) => d.source_index === i)
    // Prices only when the merchant literally wrote them — never from generation output.
    const price = product.price !== null && priceStatedByMerchant(product.price, rt.merchantText) ? product.price : null
    await rt.step(`Чернова ${i + 1} от ${products.length}`, 40 + Math.round((50 * i) / products.length))
    const created = await rt.tool(
      "catalogue.create_product_draft",
      {
        title: draft?.title ?? product.name,
        title_source: draft && draft.title !== product.name ? "ai_inference" : "merchant_fact",
        description: draft?.description ?? product.details ?? "",
        description_source: draft?.description && draft.description !== product.details ? "ai_inference" : "merchant_fact",
        merchant_price_eur: price,
      },
      `product:${i}:${product.name.toLowerCase()}`
    )
    productIds.push(String(created.product_id))
  }
  return { product_ids: productIds }
}

const images: TaskImplementation = async (rt) => {
  const mediaIds = rt.input.media_asset_ids ?? []
  if (!mediaIds.length) {
    return { attached: [] }
  }
  const productIds = ((await rt.dependencyResult("catalogue"))?.product_ids ?? []) as string[]
  const attached: { media_asset_id: string; product_id: string }[] = []
  for (let i = 0; i < mediaIds.length && i < productIds.length; i++) {
    await rt.step(`Снимка ${i + 1} от ${mediaIds.length}`, Math.round((90 * i) / mediaIds.length))
    await rt.tool(
      "media.attach_product_image",
      // Photos are paired with drafts by upload order; provenance records that this is an inference.
      { media_asset_id: mediaIds[i], product_id: productIds[i], pairing: "position_inference" },
      `image:${mediaIds[i]}:${productIds[i]}`
    )
    attached.push({ media_asset_id: mediaIds[i], product_id: productIds[i] })
  }
  return { attached, unattached: mediaIds.slice(attached.length) }
}

const storefront: TaskImplementation = async (rt) => {
  await rt.step("Текстове за началната страница", 15)
  const brandResult = await rt.dependencyResult("brand")
  const home = await rt.model({
    purpose: "generation",
    operation: "storefront.home_copy",
    schema: HomeCopySchema,
    input: {
      store_name: storeNameOf(rt),
      description: rt.input.description,
      tagline: brandResult?.tagline ?? "",
      ...withInstruction(rt),
    },
    task: "Write the home page copy for this store.",
  })
  await rt.step("Прилагане в чернова", 55)
  const suffix = rt.task.instruction ? `:${rt.task.id}` : ""
  await rt.tool("storefront.update_home", home, `home${suffix}`)
  await rt.step("Заявка за преглед", 80)
  const deployment = await rt.tool("storefront.request_preview_deployment", {}, `preview${suffix}`)
  return { deployment_id: deployment.deployment_id }
}

const offers: TaskImplementation = async (rt) => {
  const productIds = ((await rt.dependencyResult("catalogue"))?.product_ids ?? []) as string[]
  if (!productIds.length) {
    return { suggestions: 0 }
  }
  await rt.step("Предложения за оферти", 20)
  const generations = await rt.productDraftTitles()
  const suggestion = await rt.model({
    purpose: "generation",
    operation: "offers.suggest",
    schema: OffersSchema,
    input: { products: generations.map((title) => ({ title })), ...withInstruction(rt) },
    task: "Suggest offers the merchant can review later.",
  })
  const suffix = rt.task.instruction ? `:${rt.task.id}` : ""
  for (let i = 0; i < suggestion.offers.length; i++) {
    await rt.tool("offers.propose", { offer: suggestion.offers[i] }, `offer:${i}${suffix}`)
  }
  return { suggestions: suggestion.offers.length }
}

/**
 * One designer turn (M3). The selection stored on the merchant message was
 * resolved by the server when the message was sent; it is re-resolved here
 * against the current head, because the draft may have changed since (D6).
 * The model only returns a validated plan; every change is an audited tool call.
 */
const designer: TaskImplementation = async (rt) => {
  const container = rt.ctx.scope.container
  const env = rt.ctx.scope.storeEnvironmentId
  const turn = rt.run.input as {
    session_id: string
    merchant_message_id: string
    assistant_message_id: string
    content: string
    selected_element_id: string | null
  }
  await sqlRows(
    container,
    `UPDATE ai_designer_message SET status = 'running', updated_at = now()
      WHERE id = ? AND store_environment_id = ? AND status = 'queued'`,
    [turn.assistant_message_id, env]
  )
  await rt.step("Разглеждам черновата", 10)
  const project = await activeProjectFor(container, env)
  const head = await ensureHeadRevision(container, project.id, env)
  const config = parseStorefrontConfig(head.config)
  const selected = turn.selected_element_id ? resolveElement(config, turn.selected_element_id) : null
  const media = await sqlRows(
    container,
    `SELECT id AS media_id, original_name AS name FROM ai_media_asset
      WHERE store_environment_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30`,
    [env]
  )
  await rt.step("Работя по промяната", 30)
  // A retried turn reuses the plan of its first attempt: tool calls replay by operation index,
  // so a fresh plan could otherwise silently skip a different operation at the same index.
  const [stored] = await sqlRows(
    container,
    `SELECT result FROM ai_designer_message WHERE id = ? AND store_environment_id = ?`,
    [turn.assistant_message_id, env]
  )
  const storedPlan = DesignerPlanSchema.safeParse(stored?.result?.plan)
  const plan = storedPlan.success
    ? storedPlan.data
    : await rt.model({
        purpose: "generation",
        operation: "designer.plan",
        schema: DesignerPlanSchema,
        input: {
          message: turn.content,
          selected_element: selected,
          selection_no_longer_exists: Boolean(turn.selected_element_id && !selected),
          store_name: config.store.name,
          theme: config.theme,
          sections: config.home.sections,
          media,
        },
        task: "Plan the storefront change the merchant asked for.",
      })
  if (!storedPlan.success) {
    await sqlRows(
      container,
      `UPDATE ai_designer_message SET result = jsonb_build_object('plan', ?::jsonb), updated_at = now()
        WHERE id = ? AND store_environment_id = ?`,
      [JSON.stringify(plan), turn.assistant_message_id, env]
    )
  }
  const changes: Record<string, unknown>[] = []
  for (const [i, operation] of plan.operations.entries()) {
    await rt.step(`Прилагам промяна ${i + 1} от ${plan.operations.length}`, 40 + Math.round((50 * i) / plan.operations.length))
    changes.push({ tool: operation.op, ...(await rt.tool(operation.op, operation.args, `op:${i}`)) })
  }
  return { reply: plan.reply, changes }
}

export const TASK_IMPLEMENTATIONS: Record<TaskKey, TaskImplementation> = {
  brand,
  catalogue,
  images,
  storefront,
  offers,
  designer,
}

export { systemPrompt, dataPrompt }
export type { StartGenerationInput }
