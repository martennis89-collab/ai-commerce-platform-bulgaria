import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor, withRateLimit } from "../../../context"

/** Body: { expected_head_revision_id }. Append-only: creates a new head equal to the chosen revision. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await withRateLimit(res, async () => {
    res.json(await designerFor(req).restore(req.params.id, req.body))
  })
}
