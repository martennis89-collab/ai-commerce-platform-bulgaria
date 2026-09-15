import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor, withRateLimit } from "../../../context"

/** Body: { content, element_id | null }. The element id is re-resolved by the server. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await withRateLimit(res, async () => {
    res.status(202).json(await designerFor(req).sendMessage(req.params.id, req.body))
  })
}
