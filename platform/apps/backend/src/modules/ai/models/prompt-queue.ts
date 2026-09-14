import { model } from "@medusajs/framework/utils"
import AgentRun from "./agent-run"

/** Follow-up prompts for a run, processed strictly in sequence. */
const PromptQueueItem = model
  .define("ai_prompt_queue", {
    id: model.id({ prefix: "apq" }).primaryKey(),
    store_environment_id: model.text(),
    sequence: model.number(),
    prompt: model.text(),
    status: model.enum(["queued", "processing", "processed", "rejected"]).default("queued"),
    result: model.json().nullable(),
    error: model.text().nullable(),
    processed_at: model.dateTime().nullable(),
    run: model.belongsTo(() => AgentRun, { mappedBy: "prompts" }),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["run_id", "sequence"], unique: true },
  ])

export default PromptQueueItem
