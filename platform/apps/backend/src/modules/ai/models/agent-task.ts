import { model } from "@medusajs/framework/utils"
import AgentRun from "./agent-run"
import { RUN_STATUSES, TASK_KEYS } from "./constants"

/**
 * One independently executable unit of a run. Claimed by workers through a
 * Postgres lease; only the current lease_token may write progress or results.
 */
const AgentTask = model
  .define("ai_task", {
    id: model.id({ prefix: "atask" }).primaryKey(),
    store_environment_id: model.text(),
    task_key: model.enum([...TASK_KEYS]),
    status: model.enum([...RUN_STATUSES]).default("queued"),
    /** Task keys that must be completed (in the same run) before this task may run. */
    depends_on: model.json(),
    attempt: model.number().default(0),
    max_attempts: model.number().default(3),
    /** Follow-up instruction applied to this task (PromptQueue), if any. */
    instruction: model.text().nullable(),
    prompt_id: model.text().nullable(),
    /** Superseded by a newer task for the same key (follow-ups keep history). */
    superseded_by: model.text().nullable(),
    current_step: model.text().nullable(),
    progress: model.number().default(0),
    lease_owner: model.text().nullable(),
    lease_token: model.text().nullable(),
    lease_expires_at: model.dateTime().nullable(),
    heartbeat_at: model.dateTime().nullable(),
    tool_calls: model.number().default(0),
    result: model.json().nullable(),
    error: model.text().nullable(),
    started_at: model.dateTime().nullable(),
    finished_at: model.dateTime().nullable(),
    run: model.belongsTo(() => AgentRun, { mappedBy: "tasks" }),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["status", "lease_expires_at"] },
    // @ts-ignore column inference
    { on: ["store_environment_id"] },
  ])

export default AgentTask
