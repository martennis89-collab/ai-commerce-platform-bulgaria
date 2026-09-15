/**
 * Durable, same-backend worker (D3). Tasks live in Postgres; a worker claims one
 * with an atomic `FOR UPDATE SKIP LOCKED` lease and a fresh fencing token. Every
 * progress write, tool call and completion is conditional on that token, so a
 * worker that crashed, stalled or lost its lease can never overwrite newer
 * state. Expired leases are re-claimed by any worker; completed tool calls
 * replay from their AIAction rows instead of running twice. Follow-up prompts
 * are leased the same way.
 */
import { randomUUID } from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import type { z } from "zod"
import { AI_MODULE } from "../modules/ai"
import type AiModuleService from "../modules/ai/service"
import { buildMerchantExecutionContext, ExecutionContext } from "../tenancy/context"
import { AiLimits, aiLimits, aiWorkerConfig } from "./config"
import { LeaseLostError, LimitReachedError, ModelRequestError, TaskAbortedError, ToolRejectedError } from "./errors"
import { getModelProvider, ModelOutputError, ModelPurpose, ModelTransientError } from "./model"
import { dataPrompt, systemPrompt } from "./prompts"
import { FollowUpRouteSchema } from "./schemas"
import { merchantTextOf, recomputeRun, StartGenerationInput } from "./runs"
import { sqlRows } from "./sql"
import { TASK_IMPLEMENTATIONS } from "./tasks"
import { executeAiTool } from "./tools"
import { settleDesignerTurn, settleStrandedDesignerTurns } from "../designer/turns"

export type TaskRuntime = {
  ctx: ExecutionContext
  run: any
  task: any
  input: StartGenerationInput
  limits: AiLimits
  merchantText: string
  step(label: string, progress: number): Promise<void>
  model<T>(request: {
    purpose: ModelPurpose
    operation: string
    schema: z.ZodType<T>
    input: Record<string, unknown>
    task: string
  }): Promise<T>
  tool(name: string, args: unknown, idempotencyKey: string): Promise<Record<string, any>>
  dependencyResult(key: string): Promise<Record<string, any> | null>
  productDraftTitles(): Promise<string[]>
}

const ai = (container: MedusaContainer): AiModuleService => container.resolve(AI_MODULE)

const ACTIVE_FOLLOW_UP_DEPENDENCIES: Record<string, string[]> = { brand: [], storefront: ["brand"], offers: ["catalogue"] }

/** Atomically claims the oldest runnable task whose dependencies are completed. */
export async function claimNextTask(container: MedusaContainer, workerId: string) {
  const token = randomUUID()
  const { leaseMs } = aiWorkerConfig()
  const rows = await sqlRows(
    container,
    `UPDATE ai_task t
        SET status = 'running', lease_owner = ?, lease_token = ?,
            lease_expires_at = now() + (? * interval '1 millisecond'), heartbeat_at = now(),
            attempt = t.attempt + 1, started_at = coalesce(t.started_at, now()), error = NULL, updated_at = now()
      WHERE t.id = (
        SELECT c.id FROM ai_task c
          JOIN ai_run r ON r.id = c.run_id AND r.deleted_at IS NULL
         WHERE c.deleted_at IS NULL
           AND c.superseded_by IS NULL
           AND r.status NOT IN ('completed', 'failed', 'cancelled')
           AND r.cancel_requested_at IS NULL
           AND r.pause_requested_at IS NULL
           AND (r.deadline_at IS NULL OR r.deadline_at > now())
           AND c.attempt < c.max_attempts
           AND (
                 (c.status = 'queued' AND (c.lease_expires_at IS NULL OR c.lease_expires_at < now()))
              OR (c.status = 'running' AND c.lease_expires_at < now())
           )
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(c.depends_on::jsonb) AS dep(task_key)
              WHERE NOT EXISTS (
                SELECT 1 FROM ai_task d
                 WHERE d.run_id = c.run_id AND d.task_key = dep.task_key AND d.status = 'completed'
                   AND d.superseded_by IS NULL AND d.deleted_at IS NULL
              )
           )
         ORDER BY c.created_at
         FOR UPDATE OF c SKIP LOCKED
         LIMIT 1
      )
      RETURNING t.*`,
    [workerId, token, leaseMs]
  )
  if (!rows.length) {
    return null
  }
  await sqlRows(
    container,
    `UPDATE ai_run SET status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
      WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
    [rows[0].run_id]
  )
  return rows[0]
}

async function heartbeat(container: MedusaContainer, taskId: string, token: string) {
  const { leaseMs } = aiWorkerConfig()
  const rows = await sqlRows(
    container,
    `UPDATE ai_task t SET lease_expires_at = now() + (? * interval '1 millisecond'), heartbeat_at = now(), updated_at = now()
       FROM ai_run r
      WHERE t.id = ? AND t.lease_token = ? AND t.status = 'running' AND r.id = t.run_id
      RETURNING r.cancel_requested_at, r.pause_requested_at, r.deadline_at`,
    [leaseMs, taskId, token]
  )
  return rows[0] ?? null
}

type TaskOutcome =
  | { status: "completed"; result: Record<string, unknown> }
  | { status: "failed" | "queued" | "cancelled" | "paused"; error?: string; refundAttempt?: boolean }

async function finishTask(container: MedusaContainer, task: any, token: string, outcome: TaskOutcome) {
  const isCompleted = outcome.status === "completed"
  const refundAttempt = outcome.status === "paused" || (outcome as any).refundAttempt === true
  const rows = await sqlRows(
    container,
    `UPDATE ai_task
        SET status = ?, result = CASE WHEN ? THEN ?::jsonb ELSE result END, error = ?,
            progress = CASE WHEN ? THEN 100 ELSE progress END,
            current_step = CASE WHEN ? THEN NULL ELSE current_step END,
            finished_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN now() ELSE NULL END,
            lease_token = NULL, lease_owner = NULL,
            lease_expires_at = CASE WHEN ? = 'queued' THEN now() + interval '500 milliseconds' ELSE NULL END,
            -- A merchant pause (or a resume that raced it) is not a failed attempt.
            attempt = CASE WHEN ? THEN greatest(attempt - 1, 0) ELSE attempt END,
            updated_at = now()
      WHERE id = ? AND lease_token = ?
      RETURNING id`,
    [
      outcome.status, // $1 status
      isCompleted, // $2 result?
      JSON.stringify(isCompleted ? outcome.result : null), // $3
      isCompleted ? null : (outcome as any).error ?? null, // $4 error
      isCompleted, // $5 progress
      isCompleted, // $6 current_step
      outcome.status, // $7 finished_at
      outcome.status, // $8 lease_expires_at backoff
      refundAttempt, // $9 attempt refund
      task.id, // $10
      token, // $11
    ]
  )
  return rows.length > 0
}

function classify(error: any): { retryable: boolean; code: string } {
  if (error instanceof ModelTransientError) return { retryable: true, code: "model_unavailable" }
  if (error instanceof ModelRequestError) return { retryable: false, code: "model_unavailable" }
  if (error instanceof ModelOutputError) return { retryable: false, code: "model_output_rejected" }
  if (error instanceof ToolRejectedError) return { retryable: false, code: "policy_rejected" }
  if (error instanceof LimitReachedError || error?.name === "RateLimitError") return { retryable: false, code: "limit_reached" }
  // The draft head moved during the task (another edit): re-read and retry. executeClaimedTask never
  // retries a cancel-requested run, so a turn cancelled by a restore cannot retry onto the restored draft.
  if (error?.name === "RevisionConflictError") return { retryable: true, code: "revision_conflict" }
  if (
    error instanceof MedusaError &&
    [MedusaError.Types.NOT_FOUND, MedusaError.Types.NOT_ALLOWED, MedusaError.Types.UNAUTHORIZED, MedusaError.Types.FORBIDDEN].includes(error.type as any)
  ) {
    // Ownership or permission failures (e.g. the merchant lost access mid-run) never succeed on retry.
    return { retryable: false, code: "policy_rejected" }
  }
  return { retryable: true, code: "internal" }
}

/** Runs one claimed task to a fenced terminal state. */
export async function executeClaimedTask(container: MedusaContainer, task: any, workerId: string) {
  const token: string = task.lease_token
  const service = ai(container)
  const [run] = (await service.listAgentRuns({ id: task.run_id })) as any[]
  const { heartbeatMs } = aiWorkerConfig()
  const limits: AiLimits = { ...aiLimits(), ...(run?.limits ?? {}) }
  // Only irreversible signals are cached between checkpoints. Pause and deadline are
  // re-read at every checkpoint, because a resume or a retry can clear them.
  let abort: TaskAbortedError | LeaseLostError | null = null

  const timer = setInterval(async () => {
    try {
      const state = await heartbeat(container, task.id, token)
      if (!state) abort ??= new LeaseLostError()
      else if (state.cancel_requested_at) abort ??= new TaskAbortedError("cancelled")
    } catch {
      // Transient DB errors: the lease simply expires if heartbeats keep failing.
    }
  }, heartbeatMs)

  const checkpoint = async () => {
    if (abort) throw abort
    const state = await heartbeat(container, task.id, token)
    if (!state) throw new LeaseLostError()
    if (state.cancel_requested_at) throw new TaskAbortedError("cancelled")
    if (state.pause_requested_at) throw new TaskAbortedError("paused")
    if (state.deadline_at && new Date(state.deadline_at) <= new Date()) throw new LimitReachedError("run duration")
  }

  try {
    if (!run) {
      throw new LimitReachedError("run missing")
    }
    // Tenant context comes from the run's requesting merchant, rebuilt server-side, never from task data.
    const designerTurn = run.kind === "designer_edit" ? (run.input as { assistant_message_id: string; selected_element_id: string | null }) : null
    const ctx = await buildMerchantExecutionContext(container, run.requested_by, {
      current_page: designerTurn ? "designer" : null,
      // Trusted server data only: the selection the server resolved when the merchant sent the message.
      selected_entity: designerTurn?.selected_element_id ? { type: "storefront_element", id: designerTurn.selected_element_id } : null,
    })
    if (ctx.store_environment.id !== task.store_environment_id || run.store_environment_id !== task.store_environment_id) {
      throw new ToolRejectedError("policy", "execution context does not match the run's store environment")
    }
    const input = run.input as StartGenerationInput
    const merchantText = run.kind === "designer_edit" ? String((run.input as any).content ?? "") : merchantTextOf(input)
    let lastModel: { provider: string | null; model: string | null } = { provider: null, model: null }

    const rt: TaskRuntime = {
      ctx,
      run,
      task,
      input,
      limits,
      merchantText,
      async step(label, progress) {
        await checkpoint()
        await sqlRows(
          container,
          `UPDATE ai_task SET current_step = ?, progress = ?, updated_at = now() WHERE id = ? AND lease_token = ?`,
          [label, Math.max(0, Math.min(99, Math.round(progress))), task.id, token]
        )
        await recomputeRun(container, run.id)
      },
      async model(request) {
        await checkpoint()
        const reserved = await sqlRows(
          container,
          `UPDATE ai_run
              SET usage = jsonb_set(coalesce(usage::jsonb, '{}'::jsonb), '{model_calls}',
                    to_jsonb(coalesce((usage::jsonb->>'model_calls')::int, 0) + 1)),
                  updated_at = now()
            WHERE id = ?
              AND coalesce((usage::jsonb->>'model_calls')::int, 0) < ?
              AND coalesce((usage::jsonb->>'input_tokens')::int, 0) + coalesce((usage::jsonb->>'output_tokens')::int, 0) < ?
            RETURNING id`,
          [run.id, limits.maxModelCallsPerRun, limits.maxTokensPerRun]
        )
        if (!reserved.length) {
          throw new LimitReachedError("model budget for this run")
        }
        const result = await getModelProvider().generateStructured({
          purpose: request.purpose,
          operation: request.operation,
          system: systemPrompt(request.operation),
          prompt: dataPrompt(request.task, request.input),
          input: request.input,
          schema: request.schema,
        })
        lastModel = { provider: result.provider, model: result.model }
        await recordUsage(container, run.id, result.usage)
        return result.output
      },
      async tool(name, args, idempotencyKey) {
        await checkpoint()
        return executeAiTool(
          {
            ctx,
            runId: run.id,
            taskId: task.id,
            leaseToken: token,
            actor: { user_id: ctx.user.id, ...lastModel },
            merchantText,
            limits,
            designerMessageId: designerTurn?.assistant_message_id ?? null,
          },
          name,
          args,
          `${task.task_key}:${idempotencyKey}`
        )
      },
      async dependencyResult(key) {
        const active = ((await service.listAgentTasks({ run_id: run.id, task_key: key as any }, { take: null })) as any[]).find(
          (t) => !t.superseded_by && t.status === "completed"
        )
        return active?.result ?? null
      },
      async productDraftTitles() {
        const drafts = (await service.listGenerations({ run_id: run.id, kind: "product_draft" }, { take: null })) as any[]
        return drafts.map((d) => String(d.payload?.title ?? "")).filter(Boolean)
      },
    }

    const implementation = TASK_IMPLEMENTATIONS[task.task_key as keyof typeof TASK_IMPLEMENTATIONS]
    const result = await implementation(rt)
    await checkpoint()
    await finishTask(container, task, token, { status: "completed", result })
  } catch (error: any) {
    if (error instanceof LeaseLostError) {
      // Someone else owns the task now; write nothing.
    } else if (error instanceof TaskAbortedError && error.reason === "cancelled") {
      await finishTask(container, task, token, { status: "cancelled" })
    } else if (error instanceof TaskAbortedError) {
      const [state] = await sqlRows(container, `SELECT pause_requested_at FROM ai_run WHERE id = ?`, [task.run_id])
      // If the merchant already resumed, re-queue instead of stranding the task as paused.
      await finishTask(container, task, token, state?.pause_requested_at ? { status: "paused" } : { status: "queued", refundAttempt: true })
    } else {
      const { retryable, code } = classify(error)
      const message = `${code}: ${String(error?.message ?? error).slice(0, 1500)}`
      const canRetry = retryable && task.attempt < task.max_attempts
      // A cancelled run is never retried, whatever the error (e.g. a revision conflict caused by the restore that cancelled it).
      const [state] = canRetry ? await sqlRows(container, `SELECT cancel_requested_at FROM ai_run WHERE id = ?`, [task.run_id]) : []
      const outcome: TaskOutcome = !canRetry
        ? { status: "failed", error: message }
        : state?.cancel_requested_at
          ? { status: "cancelled" }
          : { status: "queued", error: message }
      await finishTask(container, task, token, outcome)
    }
  } finally {
    clearInterval(timer)
    await recomputeRun(container, task.run_id).catch(() => undefined)
    if (run?.kind === "designer_edit") {
      await settleDesignerTurn(container, task.run_id).catch(() => undefined)
    }
  }
}

async function recordUsage(container: MedusaContainer, runId: string, usage: { input_tokens: number; output_tokens: number }) {
  await sqlRows(
    container,
    `UPDATE ai_run
        SET usage = jsonb_set(jsonb_set(coalesce(usage::jsonb, '{}'::jsonb),
              '{input_tokens}', to_jsonb(coalesce((usage::jsonb->>'input_tokens')::int, 0) + ?)),
              '{output_tokens}', to_jsonb(coalesce((usage::jsonb->>'output_tokens')::int, 0) + ?)),
            updated_at = now()
      WHERE id = ?`,
    [usage.input_tokens, usage.output_tokens, runId]
  )
}

/**
 * Housekeeping on every worker tick:
 * - fails tasks that exhausted attempts on expired leases, and non-paused runs past their deadline;
 * - re-queues tasks left `paused` in runs that are no longer paused;
 * - recomputes every active run, so a status written from a stale read heals itself.
 */
export async function sweepExpired(container: MedusaContainer) {
  const touched = await sqlRows(
    container,
    `UPDATE ai_task SET status = 'failed', error = 'internal: lease expired after final attempt',
            finished_at = now(), lease_token = NULL, lease_owner = NULL, updated_at = now()
      WHERE deleted_at IS NULL AND status = 'running' AND lease_expires_at < now() AND attempt >= max_attempts
      RETURNING run_id`
  )
  const expiredRuns = await sqlRows(
    container,
    `UPDATE ai_task t SET status = 'failed', error = 'limit_reached: run duration', finished_at = now(),
            lease_token = NULL, lease_owner = NULL, updated_at = now()
       FROM ai_run r
      WHERE r.id = t.run_id AND t.deleted_at IS NULL AND r.deadline_at < now()
        AND r.status NOT IN ('completed', 'failed', 'cancelled')
        AND r.pause_requested_at IS NULL
        AND (t.status IN ('queued', 'waiting') OR (t.status = 'running' AND t.lease_expires_at < now()))
      RETURNING t.run_id`
  )
  const healed = await sqlRows(
    container,
    `UPDATE ai_task t SET status = 'queued', updated_at = now()
       FROM ai_run r
      WHERE r.id = t.run_id AND t.deleted_at IS NULL AND t.status = 'paused'
        AND r.pause_requested_at IS NULL AND r.cancel_requested_at IS NULL
      RETURNING t.run_id`
  )
  const active = await sqlRows(
    container,
    `SELECT id AS run_id FROM ai_run
      WHERE deleted_at IS NULL AND status NOT IN ('completed', 'failed', 'cancelled')
        AND updated_at < now() - interval '5 seconds'
      ORDER BY updated_at LIMIT 50`
  )
  for (const runId of new Set([...touched, ...expiredRuns, ...healed, ...active].map((r) => r.run_id))) {
    await recomputeRun(container, runId)
    // Designer turns mirror their run onto the assistant message; an unsettled message would block the store's designer.
    await settleDesignerTurn(container, runId).catch(() => undefined)
  }
  await settleStrandedDesignerTurns(container).catch(() => undefined)
}

/** Marks every older, still-active task of the same key in the run as superseded by the given tasks. */
async function supersedePrevious(container: MedusaContainer, tasks: any[]) {
  for (const task of tasks) {
    await sqlRows(
      container,
      `UPDATE ai_task SET superseded_by = ?, updated_at = now()
        WHERE run_id = ? AND task_key = ? AND id <> ? AND superseded_by IS NULL AND deleted_at IS NULL
          AND created_at <= (SELECT created_at FROM ai_task WHERE id = ?)`,
      [task.id, task.run_id, task.task_key, task.id, task.id]
    )
  }
}

async function tasksForPrompt(container: MedusaContainer, prompt: any) {
  return ((await ai(container).listAgentTasks({ run_id: prompt.run_id }, { take: null })) as any[]).filter(
    (t) => t.prompt_id === prompt.id
  )
}

/**
 * Processes follow-up prompts strictly in order: the next prompt of a run is
 * handled only after every task created by the previous prompt is terminal.
 * A prompt is leased (fencing token + heartbeat) while it is routed, so a slow
 * model call is never processed twice, and a crashed worker's prompt is
 * recovered after its lease expires. Tasks are unique per (prompt, key).
 */
export async function processPromptQueues(container: MedusaContainer, workerId: string) {
  const { leaseMs, heartbeatMs } = aiWorkerConfig()
  const claimed = await sqlRows(
    container,
    `UPDATE ai_prompt_queue q
        SET status = 'processing', lease_token = gen_random_uuid()::text,
            lease_expires_at = now() + (? * interval '1 millisecond'), updated_at = now()
      WHERE q.id IN (
        SELECT p.id FROM ai_prompt_queue p
          JOIN ai_run r ON r.id = p.run_id AND r.deleted_at IS NULL
         WHERE p.deleted_at IS NULL
           AND (p.status = 'queued' OR (p.status = 'processing' AND (p.lease_expires_at IS NULL OR p.lease_expires_at < now())))
           AND r.cancel_requested_at IS NULL AND r.pause_requested_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM ai_prompt_queue e WHERE e.run_id = p.run_id AND e.deleted_at IS NULL
                            AND e.sequence < p.sequence AND e.status IN ('queued', 'processing'))
           AND NOT EXISTS (SELECT 1 FROM ai_task t WHERE t.run_id = p.run_id AND t.deleted_at IS NULL
                            AND t.superseded_by IS NULL AND t.status IN ('queued', 'running', 'paused'))
         ORDER BY p.created_at
         FOR UPDATE OF p SKIP LOCKED
         LIMIT 5
      )
      RETURNING q.*`,
    [leaseMs]
  )
  const service = ai(container)
  for (const prompt of claimed) {
    const token: string = prompt.lease_token
    const timer = setInterval(() => {
      sqlRows(
        container,
        `UPDATE ai_prompt_queue SET lease_expires_at = now() + (? * interval '1 millisecond') WHERE id = ? AND lease_token = ?`,
        [leaseMs, prompt.id, token]
      ).catch(() => undefined)
    }, heartbeatMs)
    const settle = (status: "processed" | "queued" | "rejected", result: unknown, error: string | null) =>
      sqlRows(
        container,
        `UPDATE ai_prompt_queue
            SET status = ?, result = coalesce(?::jsonb, result), error = ?,
                processed_at = CASE WHEN ? = 'processed' THEN coalesce(processed_at, now()) ELSE processed_at END,
                lease_token = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE id = ? AND lease_token = ?`,
        [status, result === null ? null : JSON.stringify(result), error, status, prompt.id, token]
      )

    try {
      const [run] = (await service.listAgentRuns({ id: prompt.run_id })) as any[]
      // Idempotent recovery: tasks already created for this prompt are kept, never duplicated.
      const existing = await tasksForPrompt(container, prompt)
      if (existing.length) {
        await supersedePrevious(container, existing)
        await settle("processed", { targets: existing.map((t) => t.task_key), recovered: true }, null)
        continue
      }
      const runLimits = { ...aiLimits(), ...(run.limits ?? {}) }
      const reserved = await sqlRows(
        container,
        `UPDATE ai_run SET usage = jsonb_set(coalesce(usage::jsonb, '{}'::jsonb), '{model_calls}',
                to_jsonb(coalesce((usage::jsonb->>'model_calls')::int, 0) + 1)), updated_at = now()
          WHERE id = ? AND coalesce((usage::jsonb->>'model_calls')::int, 0) < ? RETURNING id`,
        [run.id, runLimits.maxModelCallsPerRun]
      )
      if (!reserved.length) {
        throw new LimitReachedError("model budget for this run")
      }
      const input = { prompt: prompt.prompt }
      const route = await getModelProvider().generateStructured({
        purpose: "extraction",
        operation: "followup.route",
        system: systemPrompt("followup.route"),
        prompt: dataPrompt("Classify this follow-up request.", input),
        input,
        schema: FollowUpRouteSchema,
      })
      await recordUsage(container, run.id, route.usage)

      const unsupported = route.output.targets.includes("unsupported")
      const targets: string[] = [...new Set(route.output.targets)].filter((t) => t !== "unsupported")
      if (!targets.length) {
        await settle("rejected", { unsupported: true }, "unsupported_request: product, price, stock and publishing changes are not follow-up targets")
        continue
      }
      // A new theme only reaches the preview through a storefront rebuild.
      if (targets.includes("brand") && !targets.includes("storefront")) {
        targets.push("storefront")
      }

      const held = await sqlRows(container, `SELECT 1 FROM ai_prompt_queue WHERE id = ? AND lease_token = ?`, [prompt.id, token])
      if (!held.length) {
        // The lease expired while routing; another worker owns this prompt now.
        continue
      }
      let created: any[]
      try {
        created = (await service.createAgentTasks(
          targets.map((key) => ({
            run_id: run.id,
            store_environment_id: run.store_environment_id,
            task_key: key,
            status: "queued",
            depends_on: ACTIVE_FOLLOW_UP_DEPENDENCIES[key] ?? [],
            max_attempts: runLimits.maxTaskAttempts,
            instruction: route.output.instruction,
            prompt_id: prompt.id,
          })) as any
        )) as any[]
      } catch (error: any) {
        // Unique (prompt_id, task_key): another holder already created this prompt's tasks.
        if (!/unique|duplicate|already exists/i.test(String(error?.message))) {
          throw error
        }
        created = await tasksForPrompt(container, prompt)
      }
      await supersedePrevious(container, created)
      await settle("processed", { targets, instruction: route.output.instruction, unsupported, worker: workerId }, null)
    } catch (error: any) {
      const { retryable, code } = classify(error)
      await settle(retryable ? "queued" : "rejected", null, `${code}: ${String(error?.message ?? error).slice(0, 500)}`)
    } finally {
      clearInterval(timer)
      await recomputeRun(container, prompt.run_id).catch(() => undefined)
    }
  }
  return claimed.length
}

/** Claims and executes tasks until none are runnable or the time budget is spent. */
export async function drainTasks(
  container: MedusaContainer,
  options: { workerId?: string; budgetMs?: number; concurrency?: number } = {}
) {
  const config = aiWorkerConfig()
  const workerId = options.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`
  const deadline = Date.now() + (options.budgetMs ?? config.drainBudgetMs)
  const concurrency = options.concurrency ?? config.concurrency
  let executed = 0

  const lane = async () => {
    while (Date.now() < deadline) {
      await processPromptQueues(container, workerId)
      const task = await claimNextTask(container, workerId)
      if (!task) {
        return
      }
      await executeClaimedTask(container, task, workerId)
      executed++
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => lane()))
  return executed
}
