import { model } from "@medusajs/framework/utils"

/**
 * Audit + idempotency record for every tool call made on behalf of an AI run.
 * The unique idempotency key guarantees a completed call is never executed twice.
 */
const AIAction = model.define("ai_action", {
  id: model.id({ prefix: "aact" }).primaryKey(),
  store_environment_id: model.text(),
  run_id: model.text().nullable(),
  task_id: model.text().nullable(),
  tool: model.text(),
  risk: model.number(),
  idempotency_key: model.text().unique(),
  status: model.enum(["started", "succeeded", "failed"]).default("started"),
  /** The validated tool input (tenant identity is never part of it). */
  input: model.json(),
  input_hash: model.text(),
  result: model.json().nullable(),
  error: model.text().nullable(),
  /** Who acted: merchant user, provider and model. */
  actor: model.json(),
  started_at: model.dateTime(),
  finished_at: model.dateTime().nullable(),
})

export default AIAction
