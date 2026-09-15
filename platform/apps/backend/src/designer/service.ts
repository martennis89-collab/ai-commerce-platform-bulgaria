/**
 * Tenant-scoped contextual designer service (M3). Bound to the server-built
 * ExecutionContext; no method accepts a project, environment or tenant id.
 * Every id a caller passes (session, revision, deployment, element) is resolved
 * inside the caller's own StoreEnvironment and is "not found" otherwise.
 */
import { generateEntityId, ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import { mediaIdsOf, parseStorefrontConfig, resolveElement } from "@platform/storefront-schema"
import { aiLimits } from "../ai/config"
import { sqlRows } from "../ai/sql"
import { AI_MODULE } from "../modules/ai"
import type AiModuleService from "../modules/ai/service"
import { requestPreviewDeployment } from "../storefront/deployments"
import { resolveOwnedMedia } from "../storefront/manifest"
import { NEWEST_DEPLOYMENT_ORDER } from "../storefront/ordering"
import { assertWithinRateLimit } from "../storefront/rate-limits"
import {
  activeProjectFor,
  commitDraftRevision,
  ensureHeadRevision,
  getOwnedRevision,
  listRevisionSummaries,
  RevisionConflictError,
} from "../storefront/revisions"
import { ExecutionContext, requirePermission } from "../tenancy/context"
import { cancelDesignerTurns, DESIGNER_TURN_LIMITS } from "./turns"

const notFound = (what: string) => new MedusaError(MedusaError.Types.NOT_FOUND, `${what} not found`)
const invalid = (code: string) => new MedusaError(MedusaError.Types.INVALID_DATA, code)

const ID = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-Z]{26}$`))

export const SendMessageBody = z.strictObject({
  content: z.string().trim().min(1).max(2000),
  element_id: z.string().max(80).nullable(),
})
export const ExpectedHeadBody = z.strictObject({ expected_head_revision_id: ID("srev") })
export const PromoteBody = z.strictObject({ revision_id: ID("srev").nullable() })
export const SelectionBody = z.strictObject({ element_id: z.string().max(80) })

const MERCHANT_DEPLOYMENT_ERROR = "Deployment failed"

const safeDeployment = (d: any) => ({
  id: d.id,
  status: d.status,
  sequence: d.sequence ?? null,
  revision_id: d.revision_id ?? null,
  url: d.status === "ready" ? d.url ?? null : null,
  error: d.status === "failed" ? MERCHANT_DEPLOYMENT_ERROR : null,
  created_at: d.created_at,
  finished_at: d.finished_at ?? null,
})

const safeMessage = (m: any) => ({
  id: m.id,
  sequence: m.sequence,
  role: m.role,
  content: m.content,
  status: m.status,
  selected_element: m.selected_element
    ? { element_id: m.selected_element.element_id, label: m.selected_element.label }
    : null,
  changes: (m.result?.changes ?? []).map((c: any) => ({ revision_id: c.revision_id, sequence: c.sequence, summary: c.summary })),
  error_code: m.error_code ?? null,
  created_at: m.created_at,
})

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    throw invalid("invalid_request")
  }
  return parsed.data
}

export function merchantDesigner(ctx: ExecutionContext) {
  const container = ctx.scope.container
  const env = ctx.scope.storeEnvironmentId
  const ai = (): AiModuleService => container.resolve(AI_MODULE)

  async function ownedSession(sessionId: unknown) {
    if (!ID("dses").safeParse(sessionId).success) {
      throw notFound("designer session")
    }
    const [session] = await sqlRows(
      container,
      `SELECT * FROM ai_designer_session WHERE id = ? AND store_environment_id = ? AND deleted_at IS NULL`,
      [sessionId, env]
    )
    if (!session) {
      throw notFound("designer session")
    }
    return session
  }

  async function publishedProducts() {
    const productIds = await ctx.scope.ownedIds("product")
    if (!productIds.length) {
      return []
    }
    const { data } = await ctx.scope.query().graph({
      entity: "product",
      fields: ["id", "title", "thumbnail", "status", "variants.prices.amount", "variants.prices.currency_code"],
      filters: { id: productIds, status: "published" },
    })
    return (data as any[]).slice(0, 100).map((p) => {
      const price = p.variants?.[0]?.prices?.find((x: any) => x.currency_code === "eur") ?? null
      return {
        id: p.id,
        title: p.title,
        thumbnail: p.thumbnail ?? null,
        price: price ? { amount: Number(price.amount), currency_code: "eur" } : null,
      }
    })
  }

  return {
    /** Everything the designer screen needs to render the caller's own draft. */
    async getState() {
      requirePermission(ctx, "storefront:read")
      const project = await activeProjectFor(container, env)
      const head = await ensureHeadRevision(container, project.id, env)
      const config = parseStorefrontConfig(head.config)
      let media: Record<string, { url: string }> = {}
      try {
        media = await resolveOwnedMedia(container, env, mediaIdsOf(config))
      } catch {
        media = {}
      }
      const deployments = await sqlRows(
        container,
        `SELECT * FROM storefront_deployment WHERE project_id = ? AND store_environment_id = ? AND target = 'preview'
           AND deleted_at IS NULL ORDER BY ${NEWEST_DEPLOYMENT_ORDER} LIMIT 5`,
        [project.id, env]
      )
      const screenshots = await sqlRows(
        container,
        `SELECT id, viewport, width, height, url, deployment_id, revision_id, created_at FROM storefront_screenshot
          WHERE project_id = ? AND store_environment_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 6`,
        [project.id, env]
      )
      const [session] = await sqlRows(
        container,
        `SELECT id FROM ai_designer_session WHERE store_environment_id = ? AND project_id = ? AND status = 'active'
           AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [env, project.id]
      )
      return {
        store: { name: config.store.name, handle: project.handle },
        head: { id: head.id, sequence: head.sequence, parent_revision_id: head.parent_revision_id, config },
        preview_revision_id: project.preview_revision_id ?? null,
        revisions: await listRevisionSummaries(container, env, project.id, 50),
        media,
        products: await publishedProducts(),
        deployments: deployments.map(safeDeployment),
        screenshots,
        session_id: session?.id ?? null,
        can_design: ctx.permissions.includes("storefront:design"),
        can_deploy: ctx.permissions.includes("storefront:deploy"),
      }
    },

    /** Re-resolves a browser-reported element id against the caller's own current draft (D6). */
    async resolveSelection(body: unknown) {
      requirePermission(ctx, "storefront:read")
      const { element_id } = parse(SelectionBody, body)
      const project = await activeProjectFor(container, env)
      const head = await ensureHeadRevision(container, project.id, env)
      const resolved = resolveElement(parseStorefrontConfig(head.config), element_id)
      if (!resolved) {
        throw notFound("storefront element")
      }
      return { ...resolved, revision_id: head.id }
    },

    async createSession() {
      requirePermission(ctx, "storefront:design")
      const project = await activeProjectFor(container, env)
      const session: any = await ai().createDesignerSessions({
        store_environment_id: env,
        project_id: project.id,
        created_by: ctx.user.id,
        status: "active",
      } as any)
      return { id: session.id }
    },

    async getSession(sessionId: unknown) {
      requirePermission(ctx, "storefront:read")
      const session = await ownedSession(sessionId)
      const messages = await sqlRows(
        container,
        `SELECT * FROM ai_designer_message WHERE session_id = ? AND store_environment_id = ? AND deleted_at IS NULL
          ORDER BY sequence DESC LIMIT 200`,
        [session.id, env]
      )
      return { id: session.id, status: session.status, messages: messages.reverse().map(safeMessage) }
    },

    /** Sends a merchant message and queues one designer turn for it. */
    async sendMessage(sessionId: unknown, body: unknown) {
      requirePermission(ctx, "storefront:design")
      const { content, element_id } = parse(SendMessageBody, body)
      const session = await ownedSession(sessionId)
      if (session.status !== "active") {
        throw invalid("session_archived")
      }
      const project = await activeProjectFor(container, env)
      const head = await ensureHeadRevision(container, project.id, env)
      const selected = element_id === null ? null : resolveElement(parseStorefrontConfig(head.config), element_id)
      if (element_id !== null && !selected) {
        throw invalid("selection_not_found")
      }
      await assertWithinRateLimit(container, env, "designer_turn")

      const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const { merchant, assistant } = await knex.transaction(async (trx: any) => {
        const q = async (sql: string, b: unknown[]) => ((await trx.raw(sql, b))?.rows ?? []) as any[]
        // One unfinished turn per store: serialised so two tabs cannot start overlapping edits.
        await q(`SELECT pg_advisory_xact_lock(hashtext(?))`, [`designer_turn:${env}`])
        const [busy] = await q(
          `SELECT id FROM ai_designer_message WHERE store_environment_id = ? AND role = 'assistant'
             AND status IN ('queued', 'running') AND deleted_at IS NULL LIMIT 1`,
          [env]
        )
        if (busy) {
          throw new MedusaError(MedusaError.Types.CONFLICT, "turn_in_progress")
        }
        const [{ last }] = await q(
          `SELECT coalesce(max(sequence), 0)::int AS last FROM ai_designer_message WHERE session_id = ?`,
          [session.id]
        )
        const insert = (sequence: number, role: string, text: string, status: string, selection: unknown) =>
          q(
            `INSERT INTO ai_designer_message
               (id, store_environment_id, session_id, sequence, role, content, status, selected_element, base_revision_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, now(), now()) RETURNING *`,
            [generateEntityId(undefined, "dmsg"), env, session.id, sequence, role, text, status, selection === null ? null : JSON.stringify(selection), head.id]
          )
        const [merchantRow] = await insert(last + 1, "merchant", content, "completed", selected)
        const [assistantRow] = await insert(last + 2, "assistant", "", "queued", null)
        await q(`UPDATE ai_designer_session SET last_message_at = now(), updated_at = now() WHERE id = ?`, [session.id])
        return { merchant: merchantRow, assistant: assistantRow }
      })

      try {
        const limits = { ...aiLimits(), ...DESIGNER_TURN_LIMITS }
        const run: any = await ai().createAgentRuns({
          store_environment_id: env,
          kind: "designer_edit",
          status: "queued",
          requested_by: ctx.user.id,
          input: {
            session_id: session.id,
            merchant_message_id: merchant.id,
            assistant_message_id: assistant.id,
            content,
            selected_element_id: selected?.element_id ?? null,
          },
          limits,
          usage: { model_calls: 0, input_tokens: 0, output_tokens: 0 },
          deadline_at: new Date(Date.now() + limits.maxRunDurationMs),
        } as any)
        await ai().createAgentTasks({
          run_id: run.id,
          store_environment_id: env,
          task_key: "designer",
          status: "queued",
          depends_on: [],
          max_attempts: limits.maxTaskAttempts,
        } as any)
        await sqlRows(container, `UPDATE ai_designer_message SET run_id = ?, updated_at = now() WHERE id = ?`, [run.id, assistant.id])
      } catch (error) {
        await sqlRows(
          container,
          `UPDATE ai_designer_message SET status = 'failed', error_code = 'internal', updated_at = now() WHERE id = ?`,
          [assistant.id]
        )
        throw error
      }
      return { merchant_message: safeMessage(merchant), assistant_message: safeMessage({ ...assistant }) }
    },

    /** Append-only restore of an earlier revision (D8). Cancels in-flight designer turns first. */
    async restore(revisionId: unknown, body: unknown) {
      requirePermission(ctx, "storefront:design")
      const { expected_head_revision_id } = parse(ExpectedHeadBody, body)
      const target = await getOwnedRevision(container, env, revisionId)
      const project = await activeProjectFor(container, env)
      if (target.project_id !== project.id) {
        throw notFound("storefront revision")
      }
      await assertWithinRateLimit(container, env, "designer_edit")
      const cancelled = await cancelDesignerTurns(container, env)
      const revision = await commitDraftRevision(container, {
        projectId: project.id,
        storeEnvironmentId: env,
        parentRevisionId: expected_head_revision_id,
        config: target.config,
        author: { type: "merchant", user_id: ctx.user.id },
        summary: `Върната версия ${target.sequence}`,
        restoredFromRevisionId: target.id,
      })
      return { revision: { id: revision.id, sequence: revision.sequence, summary: revision.summary }, cancelled_turns: cancelled }
    },

    /** Undo = restore the parent of the current head. */
    async undo(body: unknown) {
      requirePermission(ctx, "storefront:design")
      const { expected_head_revision_id } = parse(ExpectedHeadBody, body)
      const project = await activeProjectFor(container, env)
      const head = await ensureHeadRevision(container, project.id, env)
      if (head.id !== expected_head_revision_id) {
        throw new RevisionConflictError()
      }
      if (!head.parent_revision_id) {
        throw invalid("nothing_to_undo")
      }
      const parent = await getOwnedRevision(container, env, head.parent_revision_id)
      await assertWithinRateLimit(container, env, "designer_edit")
      const cancelled = await cancelDesignerTurns(container, env)
      const revision = await commitDraftRevision(container, {
        projectId: project.id,
        storeEnvironmentId: env,
        parentRevisionId: head.id,
        config: parent.config,
        author: { type: "merchant", user_id: ctx.user.id },
        summary: `Отменена промяна (версия ${head.sequence})`,
        restoredFromRevisionId: parent.id,
      })
      return { revision: { id: revision.id, sequence: revision.sequence, summary: revision.summary }, cancelled_turns: cancelled }
    },

    /** Promotes the head (or a named revision) to a real per-project preview build (risk 1). Never live. */
    async promote(body: unknown) {
      requirePermission(ctx, "storefront:deploy")
      const { revision_id } = parse(PromoteBody, body)
      const deployment = await requestPreviewDeployment(container, env, {
        revisionId: revision_id ?? undefined,
        requestedBy: ctx.user.id,
      })
      return safeDeployment(deployment)
    },
  }
}
