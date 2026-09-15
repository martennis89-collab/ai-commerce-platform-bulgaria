/**
 * Designer turn lifecycle (M3). A merchant message creates one bounded
 * `designer_edit` AgentRun with a single `designer` task that runs through the
 * M2 lease, fencing and tool gate. The assistant message mirrors the turn
 * outcome; the revisions it created are read back from `storefront_revision`
 * (designer_message_id), so a failed or cancelled turn still reports exactly
 * what it changed before it stopped.
 *
 * Settlement is idempotent and happens on every path that can end a turn: the
 * worker, restore/undo cancellation, the expiry sweep, and a repair sweep for
 * messages any earlier settlement missed. An unsettled message would otherwise
 * block the store's designer (one unfinished turn per store).
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sqlRows } from "../ai/sql"
import { errorCodeOf, recomputeRun } from "../ai/runs"

export const DESIGNER_TURN_LIMITS = {
  maxModelCallsPerRun: 2,
  maxToolCallsPerTask: 6,
  maxTaskAttempts: 2,
  maxRunDurationMs: 5 * 60 * 1000,
}

const TERMINAL = ["completed", "failed", "cancelled"]

/** A message whose run was never created (or no longer exists) is failed after this grace period. */
export const ORPHAN_MESSAGE_GRACE_SECONDS = 120

/** Mirrors a designer run's outcome onto its assistant message. Idempotent. */
export async function settleDesignerTurn(container: MedusaContainer, runId: string) {
  const [run] = await sqlRows(
    container,
    `SELECT id, kind, input, store_environment_id, cancel_requested_at FROM ai_run WHERE id = ? AND deleted_at IS NULL`,
    [runId]
  )
  if (!run || run.kind !== "designer_edit") {
    return
  }
  const messageId = run.input?.assistant_message_id
  if (run.cancel_requested_at) {
    // A cancelled turn never runs again: close tasks still waiting to run (e.g. re-queued after an error)
    // or held by a worker whose lease expired, so the run and its message can settle.
    const closed = await sqlRows(
      container,
      `UPDATE ai_task SET status = 'cancelled', finished_at = now(), lease_token = NULL, lease_owner = NULL, updated_at = now()
        WHERE run_id = ? AND deleted_at IS NULL
          AND (status IN ('queued', 'waiting', 'paused') OR (status = 'running' AND lease_expires_at < now()))
        RETURNING id`,
      [runId]
    )
    if (closed.length) {
      await recomputeRun(container, runId)
    }
  }
  const [current] = await sqlRows(container, `SELECT status, cancel_requested_at FROM ai_run WHERE id = ?`, [runId])
  const [task] = await sqlRows(
    container,
    `SELECT status, result, error FROM ai_task WHERE run_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [runId]
  )
  const taskTerminal = Boolean(task && TERMINAL.includes(task.status))
  const runTerminal = Boolean(current && TERMINAL.includes(current.status))
  if (!taskTerminal && !runTerminal) {
    return
  }
  // The task outcome wins; a terminal run whose task never finished settles as cancelled or failed.
  const status: string = taskTerminal
    ? task.status
    : current.status === "cancelled" || current.cancel_requested_at
      ? "cancelled"
      : "failed"
  const revisions = await sqlRows(
    container,
    `SELECT id AS revision_id, sequence, summary FROM storefront_revision
      WHERE designer_message_id = ? AND store_environment_id = ? AND deleted_at IS NULL ORDER BY sequence`,
    [messageId, run.store_environment_id]
  )
  const content = status === "completed" ? String(task?.result?.reply ?? "").slice(0, 600) : ""
  const errorCode = status === "failed" ? errorCodeOf(task?.error) ?? "internal" : null
  await sqlRows(
    container,
    `UPDATE ai_designer_message
        SET status = ?, content = CASE WHEN ? <> '' THEN ? ELSE content END, result = ?::jsonb, error_code = ?, updated_at = now()
      WHERE id = ? AND store_environment_id = ? AND status IN ('queued', 'running')`,
    [status, content, content, JSON.stringify({ changes: revisions }), errorCode, messageId, run.store_environment_id]
  )
}

/**
 * Requests cancellation of every unfinished designer turn of a store (M3-D8).
 * Takes a knex executor so restore/undo can do it inside their locked commit:
 * a rejected (stale) restore then cancels nothing.
 */
export async function requestDesignerCancellation(executor: any, storeEnvironmentId: string): Promise<string[]> {
  const result = await executor.raw(
    `UPDATE ai_run SET cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
      WHERE store_environment_id = ? AND kind = 'designer_edit' AND deleted_at IS NULL
        AND status NOT IN ('completed', 'failed', 'cancelled')
      RETURNING id`,
    [storeEnvironmentId]
  )
  return ((result?.rows ?? []) as any[]).map((r) => r.id)
}

/** After a committed cancellation: closes queued tasks and settles each turn. Running tasks stop at their next checkpoint or commit guard. */
export async function finishDesignerCancellation(container: MedusaContainer, runIds: string[]) {
  for (const id of runIds) {
    await recomputeRun(container, id)
    await settleDesignerTurn(container, id)
  }
}

export async function cancelDesignerTurns(container: MedusaContainer, storeEnvironmentId: string) {
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const runIds = await requestDesignerCancellation(knex, storeEnvironmentId)
  await finishDesignerCancellation(container, runIds)
  return runIds.length
}

/**
 * Repair sweep: settles assistant messages still marked unfinished although
 * their run is terminal or cancelled, and fails messages whose run was never
 * created or no longer exists. Optionally limited to one store environment.
 */
export async function settleStrandedDesignerTurns(container: MedusaContainer, storeEnvironmentId: string | null = null) {
  const scope = storeEnvironmentId ? "AND m.store_environment_id = ?" : ""
  const scopeBindings = storeEnvironmentId ? [storeEnvironmentId] : []
  const stranded = await sqlRows(
    container,
    `SELECT DISTINCT m.run_id FROM ai_designer_message m
       JOIN ai_run r ON r.id = m.run_id AND r.deleted_at IS NULL
      WHERE m.role = 'assistant' AND m.status IN ('queued', 'running') AND m.deleted_at IS NULL ${scope}
        AND (r.status IN ('completed', 'failed', 'cancelled') OR r.cancel_requested_at IS NOT NULL)
      LIMIT 50`,
    scopeBindings
  )
  for (const { run_id } of stranded) {
    try {
      await settleDesignerTurn(container, run_id)
    } catch {
      // Retried by the next sweep.
    }
  }
  await sqlRows(
    container,
    `UPDATE ai_designer_message m SET status = 'failed', error_code = 'internal', updated_at = now()
      WHERE m.role = 'assistant' AND m.status IN ('queued', 'running') AND m.deleted_at IS NULL ${scope}
        AND m.created_at < now() - (? * interval '1 second')
        AND (m.run_id IS NULL OR NOT EXISTS (SELECT 1 FROM ai_run r WHERE r.id = m.run_id AND r.deleted_at IS NULL))`,
    [...scopeBindings, ORPHAN_MESSAGE_GRACE_SECONDS]
  )
}
