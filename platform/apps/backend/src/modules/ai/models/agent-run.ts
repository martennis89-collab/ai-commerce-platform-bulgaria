import { model } from "@medusajs/framework/utils"
import AgentTask from "./agent-task"
import PromptQueueItem from "./prompt-queue"
import { RUN_KINDS, RUN_STATUSES } from "./constants"

/** A durable AI run for one StoreEnvironment (Level 3 §5). */
const AgentRun = model
  .define("ai_run", {
    id: model.id({ prefix: "arun" }).primaryKey(),
    store_environment_id: model.text(),
    /** initial_generation (M2) or one designer turn (M3). */
    kind: model.enum([...RUN_KINDS]),
    status: model.enum([...RUN_STATUSES]).default("queued"),
    /** Authenticated merchant user that started the run; the worker rebuilds ExecutionContext from it. */
    requested_by: model.text(),
    /** Validated merchant input (description, facts, owned media asset ids). */
    input: model.json(),
    /** Limits snapshot applied to this run. */
    limits: model.json(),
    /** Accumulated usage: tokens, model calls, tool calls. */
    usage: model.json().nullable(),
    current_step: model.text().nullable(),
    progress: model.number().default(0),
    error: model.text().nullable(),
    cancel_requested_at: model.dateTime().nullable(),
    pause_requested_at: model.dateTime().nullable(),
    started_at: model.dateTime().nullable(),
    finished_at: model.dateTime().nullable(),
    deadline_at: model.dateTime().nullable(),
    tasks: model.hasMany(() => AgentTask, { mappedBy: "run" }),
    prompts: model.hasMany(() => PromptQueueItem, { mappedBy: "run" }),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["store_environment_id", "status"] },
  ])

export default AgentRun
