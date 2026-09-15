import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor } from "../context"

/** Re-resolves a preview selection against the caller's own current draft (M3-D6). */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ selection: await designerFor(req).resolveSelection(req.body) })
}
