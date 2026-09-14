/**
 * Run lifecycle (Level 3 §5): start, observe, cancel, pause, resume, retry and
 * follow-up prompts. Every function takes a server-built ExecutionContext and
 * reads/writes only rows of that StoreEnvironment; foreign ids are "not found".
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import { AI_MODULE } from "../modules/ai"
import type { RunStatus, TaskKey } from "../modules/ai/models"
import { TERMINAL_STATUSES } from "../modules/ai/models"
import type AiModuleService from "../modules/ai/service"
import { ExecutionContext, requirePermission } from "../tenancy/context"
import { aiLimits } from "./config"
import type { MerchantErrorCode } from "./errors"
import { sqlRows } from "./sql"

export const StartGenerationSchema = z.strictObject({
  description: z.string().trim().min(10).max(20_000),
  facts: z
    .strictObject({
      business_name: z.string().trim().min(1).max(80).optional(),
      location: z.string().trim().min(1).max(80).optional(),
      delivery_note: z.string().trim().max(300).optional(),
      products: z
        .array(
          z.strictObject({
            name: z.string().trim().min(1).max(80),
            price_eur: z.number().positive().max(100000).optional(),
            description: z.string().trim().max(600).optional(),
          })
        )
        .max(30)
        .optional(),
    })
    .optional(),
  media_asset_ids: z.array(z.string().regex(/^media_[0-9A-Z]{26}$/)).max(50).optional(),
})
export type StartGenerationInput = z.infer<typeof StartGenerationSchema>

export const FollowUpSchema = z.strictObject({ prompt: z.string().trim().min(2).max(20_000) })

export const INITIAL_TASKS: { key: TaskKey; depends_on: TaskKey[] }[] = [
  { key: "brand", depends_on: [] },
  { key: "catalogue", depends_on: [] },
  { key: "images", depends_on: ["catalogue"] },
  { key: "storefront", depends_on: ["brand"] },
  { key: "offers", depends_on: ["catalogue"] },
]

const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "waiting", "paused"]

const notFound = () => new MedusaError(MedusaError.Types.NOT_FOUND, "run not found")
const invalid = (detail: string) => new MedusaError(MedusaError.Types.INVALID_DATA, detail)
const limit = (detail: string) => new MedusaError(MedusaError.Types.NOT_ALLOWED, `Limit reached: ${detail}`)

const service = (container: MedusaContainer): AiModuleService => container.resolve(AI_MODULE)

/** Merchant-authored text (description + typed facts) used by fact guards such as prices. */
export function merchantTextOf(input: StartGenerationInput): string {
  return `${input.description}\n${JSON.stringify(input.facts ?? {})}`
}

export function errorCodeOf(error: string | null | undefined): MerchantErrorCode | null {
  if (!error) {
    return null
  }
  const code = error.split(":")[0]
  return (["model_unavailable", "model_output_rejected", "policy_rejected", "limit_reached", "internal"] as const).includes(
    code as MerchantErrorCode
  )
    ? (code as MerchantErrorCode)
    : "internal"
}

async function loadOwnedRun(ctx: ExecutionContext, runId: string) {
  if (typeof runId !== "string" || !/^arun_[0-9A-Z]{26}$/.test(runId)) {
    throw notFound()
  }
  const [run] = (await service(ctx.scope.container).listAgentRuns({
    id: runId,
    store_environment_id: ctx.scope.storeEnvironmentId,
  })) as any[]
  if (!run) {
    throw notFound()
  }
  return run
}

export async function startInitialGeneration(ctx: ExecutionContext, rawBody: unknown) {
  requirePermission(ctx, "ai:generate")
  const parsed = StartGenerationSchema.safeParse(rawBody)
  if (!parsed.success) {
    throw invalid("Invalid generation request")
  }
  const input = parsed.data
  const limits = aiLimits()
  if (input.description.length > limits.maxPromptChars) {
    throw invalid(`Description must be at most ${limits.maxPromptChars} characters`)
  }
  const mediaIds = [...new Set(input.media_asset_ids ?? [])]
  if (mediaIds.length > limits.maxMediaPerRun) {
    throw invalid(`At most ${limits.maxMediaPerRun} photos per run`)
  }

  const container = ctx.scope.container
  const env = ctx.scope.storeEnvironmentId
  const ai = service(container)
  if (mediaIds.length) {
    const owned = (await ai.listMediaAssets({ id: mediaIds, store_environment_id: env })) as any[]
    if (owned.length !== mediaIds.length) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "media asset not found")
    }
  }

  const [counts] = await sqlRows(
    container,
    `SELECT
       count(*) FILTER (WHERE status IN (${ACTIVE_RUN_STATUSES.map(() => "?").join(", ")})) AS active,
       count(*) FILTER (WHERE created_at > now() - interval '1 day') AS today
     FROM ai_run WHERE store_environment_id = ? AND deleted_at IS NULL`,
    [...ACTIVE_RUN_STATUSES, env]
  )
  if (Number(counts.active) >= limits.maxActiveRunsPerStore) {
    throw limit("an initial generation is already running for this store")
  }
  if (Number(counts.today) >= limits.maxRunsPerStorePerDay) {
    throw limit("daily generation runs for this store")
  }

  const run: any = await ai.createAgentRuns({
    store_environment_id: env,
    kind: "initial_generation",
    status: "queued",
    requested_by: ctx.user.id,
    input: { ...input, media_asset_ids: mediaIds },
    limits,
    usage: { model_calls: 0, input_tokens: 0, output_tokens: 0 },
    deadline_at: new Date(Date.now() + limits.maxRunDurationMs),
  } as any)
  await ai.createAgentTasks(
    INITIAL_TASKS.map((t) => ({
      run_id: run.id,
      store_environment_id: env,
      task_key: t.key,
      status: "queued",
      depends_on: t.depends_on,
      max_attempts: limits.maxTaskAttempts,
    })) as any
  )
  return getRunSummary(ctx, run.id)
}

export async function getRunSummary(ctx: ExecutionContext, runId: string) {
  requirePermission(ctx, "ai:read")
  const run = await loadOwnedRun(ctx, runId)
  const ai = service(ctx.scope.container)
  const tasks = (await ai.listAgentTasks({ run_id: run.id }, { take: null, order: { created_at: "ASC" } })) as any[]
  const prompts = (await ai.listPromptQueueItems({ run_id: run.id }, { take: null, order: { sequence: "ASC" } })) as any[]
  return {
    id: run.id,
    kind: run.kind,
    status: run.status as RunStatus,
    progress: run.progress,
    current_step: run.current_step,
    error_code: errorCodeOf(run.error),
    created_at: run.created_at,
    started_at: run.started_at,
    finished_at: run.finished_at,
    pause_requested: !!run.pause_requested_at,
    cancel_requested: !!run.cancel_requested_at,
    usage: { model_calls: run.usage?.model_calls ?? 0 },
    tasks: tasks.map((t) => ({
      id: t.id,
      key: t.task_key,
      status: t.status,
      progress: t.progress,
      current_step: t.current_step,
      attempt: t.attempt,
      max_attempts: t.max_attempts,
      depends_on: t.depends_on,
      instruction: t.instruction,
      superseded: !!t.superseded_by,
      error_code: errorCodeOf(t.error),
      finished_at: t.finished_at,
    })),
    prompts: prompts.map((p) => ({ id: p.id, sequence: p.sequence, status: p.status })),
  }
}

export async function listRunSummaries(ctx: ExecutionContext) {
  requirePermission(ctx, "ai:read")
  const runs = (await service(ctx.scope.container).listAgentRuns(
    { store_environment_id: ctx.scope.storeEnvironmentId },
    { take: 20, order: { created_at: "DESC" } }
  )) as any[]
  return runs.map((r) => ({ id: r.id, status: r.status, progress: r.progress, created_at: r.created_at }))
}

export async function listRunGenerations(ctx: ExecutionContext, runId: string) {
  requirePermission(ctx, "ai:read")
  const run = await loadOwnedRun(ctx, runId)
  const generations = (await service(ctx.scope.container).listGenerations(
    { run_id: run.id, store_environment_id: ctx.scope.storeEnvironmentId },
    { take: null, order: { created_at: "ASC" } }
  )) as any[]
  return generations.map((g) => {
    const { idempotency_key: _key, ...payload } = g.payload ?? {}
    return {
      id: g.id,
      kind: g.kind,
      status: g.status,
      payload,
      provenance: g.provenance,
      resource_type: g.resource_type,
      resource_id: g.resource_id,
    }
  })
}

export async function cancelRun(ctx: ExecutionContext, runId: string) {
  requirePermission(ctx, "ai:generate")
  const run = await loadOwnedRun(ctx, runId)
  if (!TERMINAL_STATUSES.includes(run.status)) {
    const container = ctx.scope.container
    await sqlRows(container, `UPDATE ai_run SET cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now() WHERE id = ?`, [run.id])
    await sqlRows(
      container,
      `UPDATE ai_task SET status = 'cancelled', finished_at = now(), lease_token = NULL, lease_owner = NULL, updated_at = now()
       WHERE run_id = ? AND status IN ('queued', 'waiting', 'paused') AND deleted_at IS NULL`,
      [run.id]
    )
    await recomputeRun(container, run.id)
  }
  return getRunSummary(ctx, run.id)
}

export async function pauseRun(ctx: ExecutionContext, runId: string) {
  requirePermission(ctx, "ai:generate")
  const run = await loadOwnedRun(ctx, runId)
  if (!TERMINAL_STATUSES.includes(run.status)) {
    await sqlRows(ctx.scope.container, `UPDATE ai_run SET pause_requested_at = coalesce(pause_requested_at, now()), updated_at = now() WHERE id = ?`, [run.id])
    await recomputeRun(ctx.scope.container, run.id)
  }
  return getRunSummary(ctx, run.id)
}

export async function resumeRun(ctx: ExecutionContext, runId: string) {
  requirePermission(ctx, "ai:generate")
  const run = await loadOwnedRun(ctx, runId)
  const container = ctx.scope.container
  if (run.pause_requested_at && !run.cancel_requested_at) {
    await sqlRows(container, `UPDATE ai_run SET pause_requested_at = NULL, updated_at = now() WHERE id = ?`, [run.id])
    await sqlRows(
      container,
      `UPDATE ai_task SET status = 'queued', updated_at = now() WHERE run_id = ? AND status = 'paused' AND deleted_at IS NULL`,
      [run.id]
    )
    await recomputeRun(container, run.id)
  }
  return getRunSummary(ctx, run.id)
}

export async function retryTask(ctx: ExecutionContext, runId: string, taskId: string) {
  requirePermission(ctx, "ai:generate")
  const run = await loadOwnedRun(ctx, runId)
  if (run.cancel_requested_at) {
    throw invalid("A cancelled run cannot be retried")
  }
  const container = ctx.scope.container
  const updated = await sqlRows(
    container,
    `UPDATE ai_task
       SET status = 'queued', error = NULL, finished_at = NULL, lease_token = NULL, lease_owner = NULL,
           lease_expires_at = NULL, max_attempts = attempt + ?, updated_at = now()
     WHERE id = ? AND run_id = ? AND status = 'failed' AND superseded_by IS NULL AND deleted_at IS NULL
     RETURNING id`,
    [aiLimits().maxTaskAttempts, typeof taskId === "string" ? taskId : "", run.id]
  )
  if (!updated.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "failed task not found")
  }
  await sqlRows(
    container,
    `UPDATE ai_run SET finished_at = NULL, error = NULL, deadline_at = greatest(coalesce(deadline_at, now()), now() + (? * interval '1 millisecond')), updated_at = now() WHERE id = ?`,
    [aiLimits().maxRunDurationMs, run.id]
  )
  await recomputeRun(container, run.id)
  return getRunSummary(ctx, run.id)
}

export async function enqueueFollowUp(ctx: ExecutionContext, runId: string, rawBody: unknown) {
  requirePermission(ctx, "ai:generate")
  const run = await loadOwnedRun(ctx, runId)
  const parsed = FollowUpSchema.safeParse(rawBody)
  if (!parsed.success) {
    throw invalid("Invalid follow-up prompt")
  }
  const limits = aiLimits()
  if (parsed.data.prompt.length > limits.maxPromptChars) {
    throw invalid(`Prompt must be at most ${limits.maxPromptChars} characters`)
  }
  if (run.cancel_requested_at || run.status === "cancelled") {
    throw invalid("A cancelled run cannot take follow-up prompts")
  }
  const container = ctx.scope.container
  const [{ count }] = await sqlRows(container, `SELECT count(*) AS count FROM ai_prompt_queue WHERE run_id = ? AND deleted_at IS NULL`, [run.id])
  if (Number(count) >= limits.maxFollowUpsPerRun) {
    throw limit("follow-up prompts for this run")
  }
  // The unique (run_id, sequence) index makes concurrent enqueues fail rather than share a sequence.
  await service(container).createPromptQueueItems({
    run_id: run.id,
    store_environment_id: ctx.scope.storeEnvironmentId,
    sequence: Number(count) + 1,
    prompt: parsed.data.prompt,
    status: "queued",
  } as any)
  await sqlRows(
    container,
    `UPDATE ai_run SET deadline_at = greatest(coalesce(deadline_at, now()), now() + (? * interval '1 millisecond')), updated_at = now() WHERE id = ?`,
    [limits.maxRunDurationMs, run.id]
  )
  await recomputeRun(container, run.id)
  return getRunSummary(ctx, run.id)
}

/**
 * Derives run status, progress and current step from its active (non-superseded)
 * tasks and prompts. Also moves tasks between queued/waiting as dependencies
 * fail or recover. Safe to call from anywhere, any number of times.
 */
export async function recomputeRun(container: MedusaContainer, runId: string) {
  const ai = service(container)
  const [run] = (await ai.listAgentRuns({ id: runId })) as any[]
  if (!run) {
    return
  }
  let tasks = ((await ai.listAgentTasks({ run_id: runId }, { take: null })) as any[]).filter((t) => !t.superseded_by)
  const byKey = new Map(tasks.map((t) => [t.task_key, t]))

  for (const task of tasks) {
    if (task.status !== "queued" && task.status !== "waiting") {
      continue
    }
    const blocked = (task.depends_on ?? []).some((dep: string) => {
      const d = byKey.get(dep)
      return d && ["failed", "cancelled"].includes(d.status)
    })
    const next = blocked ? "waiting" : "queued"
    if (next !== task.status) {
      await sqlRows(container, `UPDATE ai_task SET status = ?, updated_at = now() WHERE id = ? AND status IN ('queued', 'waiting')`, [next, task.id])
      task.status = next
    }
  }

  const prompts = (await ai.listPromptQueueItems({ run_id: runId }, { take: null })) as any[]
  const pendingPrompts = prompts.some((p) => p.status === "queued" || p.status === "processing")
  const count = (status: string) => tasks.filter((t) => t.status === status).length
  const running = count("running")
  const allCompleted = tasks.length > 0 && tasks.every((t) => t.status === "completed")
  const anyFailed = count("failed") > 0

  let status: RunStatus
  if (run.cancel_requested_at) {
    status = running ? "running" : "cancelled"
  } else if (allCompleted && !pendingPrompts) {
    status = "completed"
  } else if (running) {
    status = "running"
  } else if (run.pause_requested_at) {
    status = "paused"
  } else if (count("queued") > 0 || pendingPrompts) {
    status = run.started_at ? "running" : "queued"
  } else if (anyFailed) {
    status = "failed"
  } else if (count("waiting") > 0) {
    status = "waiting"
  } else {
    status = "failed"
  }

  const progress = tasks.length
    ? Math.round(tasks.reduce((sum, t) => sum + (t.status === "completed" ? 100 : Number(t.progress ?? 0)), 0) / tasks.length)
    : 0
  const current = tasks.find((t) => t.status === "running")
  const terminal = TERMINAL_STATUSES.includes(status)
  await sqlRows(
    container,
    `UPDATE ai_run
       SET status = ?, progress = ?, current_step = ?,
           finished_at = CASE WHEN ? THEN coalesce(finished_at, now()) ELSE NULL END,
           updated_at = now()
     WHERE id = ?`,
    [status, progress, current ? `${current.task_key}: ${current.current_step ?? ""}`.trim() : null, terminal, runId]
  )
}
