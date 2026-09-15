import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor, withRateLimit } from "../context"

/** Body: { expected_head_revision_id }. Restores the parent of the current head. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await withRateLimit(res, async () => {
    res.json(await designerFor(req).undo(req.body))
  })
}
