import { model } from "@medusajs/framework/utils"
import DesignerMessage from "./designer-message"

/**
 * A persistent designer conversation over one StoreEnvironment's storefront
 * project (M3-D5). Separate from M2 PromptQueue: a session is long-lived and
 * each merchant turn becomes its own bounded `designer_edit` AgentRun.
 */
const DesignerSession = model
  .define("ai_designer_session", {
    id: model.id({ prefix: "dses" }).primaryKey(),
    store_environment_id: model.text(),
    project_id: model.text(),
    created_by: model.text(),
    status: model.enum(["active", "archived"]).default("active"),
    last_message_at: model.dateTime().nullable(),
    messages: model.hasMany(() => DesignerMessage, { mappedBy: "session" }),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["store_environment_id", "status"] },
  ])

export default DesignerSession
