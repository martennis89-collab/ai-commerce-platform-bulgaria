import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor } from "./context"

/** The caller's own draft, revisions, previews, screenshots and active session. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ designer: await designerFor(req).getState() })
}
