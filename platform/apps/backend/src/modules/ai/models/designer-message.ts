import { model } from "@medusajs/framework/utils"
import DesignerSession from "./designer-session"

/**
 * One message of a designer session. Merchant messages carry the server-resolved
 * selected element (never the raw browser report). Assistant messages track the
 * designer turn that answers them: its run, status, the revisions it created and
 * a stable merchant-facing error code.
 */
const DesignerMessage = model
  .define("ai_designer_message", {
    id: model.id({ prefix: "dmsg" }).primaryKey(),
    store_environment_id: model.text(),
    sequence: model.number(),
    role: model.enum(["merchant", "assistant"]),
    content: model.text(),
    status: model.enum(["queued", "running", "completed", "failed", "cancelled"]).default("completed"),
    /** Server-resolved selection: element id, section, field, Bulgarian label. */
    selected_element: model.json().nullable(),
    /** Head revision the merchant was looking at when sending. */
    base_revision_id: model.text().nullable(),
    run_id: model.text().nullable(),
    /** Assistant: applied changes [{ tool, revision_id, sequence, summary }]. */
    result: model.json().nullable(),
    error_code: model.text().nullable(),
    session: model.belongsTo(() => DesignerSession, { mappedBy: "messages" }),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["session_id", "sequence"], unique: true },
    // @ts-ignore column inference
    { on: ["store_environment_id", "role", "created_at"] },
    // @ts-ignore column inference
    { on: ["run_id"] },
  ])

export default DesignerMessage
