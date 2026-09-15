/**
 * Designer turn lifecycle (M3). A merchant message creates one bounded
 * `designer_edit` AgentRun with a single `designer` task that runs through the
 * M2 lease, fencing and tool gate. The assistant message mirrors the task
 * outcome; the revisions it created are read back from `storefront_revision`
 * (designer_message_id), so a failed or cancelled turn still reports exactly
 * what it changed before it stopped.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { sqlRows } from "../ai/sql"
import { errorCodeOf, recomputeRun } from "../ai/runs"

export const DESIGNER_TURN_LIMITS = {
  maxModelCallsPerRun: 2,
  maxToolCallsPerTask: 6,
  maxTaskAttempts: 2,
  maxRunDurationMs: 5 * 60 * 1000,
}

/** Mirrors a designer run's task outcome onto its assistant message. Idempotent. */
export async function settleDesignerTurn(container: MedusaContainer, runId: string) {
  const [run] = await sqlRows(
    container,
    `SELECT id, kind, status, input, store_environment_id FROM ai_run WHERE id = ? AND deleted_at IS NULL`,
    [runId]
  )
  if (!run || run.kind !== "designer_edit") {
    return
  }
  const messageId = run.input?.assistant_message_id
  const [task] = await sqlRows(
    container,
    `SELECT status, result, error FROM ai_task WHERE run_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [runId]
  )
  if (!task || !["completed", "failed", "cancelled"].includes(task.status)) {
    return
  }
  const revisions = await sqlRows(
    container,
    `SELECT id AS revision_id, sequence, summary FROM storefront_revision
      WHERE designer_message_id = ? AND store_environment_id = ? AND deleted_at IS NULL ORDER BY sequence`,
    [messageId, run.store_environment_id]
  )
  const content = task.status === "completed" ? String(task.result?.reply ?? "").slice(0, 600) : ""
  const errorCode = task.status === "failed" ? errorCodeOf(task.error) : null
  await sqlRows(
    container,
    `UPDATE ai_designer_message
        SET status = ?, content = CASE WHEN ? <> '' THEN ? ELSE content END, result = ?::jsonb, error_code = ?, updated_at = now()
      WHERE id = ? AND store_environment_id = ? AND status IN ('queued', 'running')`,
    [task.status, content, content, JSON.stringify({ changes: revisions }), errorCode, messageId, run.store_environment_id]
  )
}

/**
 * Requests cancellation of every unfinished designer turn of a store (M3-D8:
 * a restore stops in-flight turns). Queued tasks are cancelled immediately;
 * running ones stop at their next checkpoint and are settled by the worker.
 */
export async function cancelDesignerTurns(container: MedusaContainer, storeEnvironmentId: string) {
  const runs = await sqlRows(
    container,
    `UPDATE ai_run SET cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
      WHERE store_environment_id = ? AND kind = 'designer_edit' AND deleted_at IS NULL
        AND status NOT IN ('completed', 'failed', 'cancelled')
      RETURNING id`,
    [storeEnvironmentId]
  )
  for (const { id } of runs) {
    await sqlRows(
      container,
      `UPDATE ai_task SET status = 'cancelled', finished_at = now(), lease_token = NULL, lease_owner = NULL, updated_at = now()
        WHERE run_id = ? AND status IN ('queued', 'waiting', 'paused') AND deleted_at IS NULL`,
      [id]
    )
    await recomputeRun(container, id)
    await settleDesignerTurn(container, id)
  }
  return runs.length
}
