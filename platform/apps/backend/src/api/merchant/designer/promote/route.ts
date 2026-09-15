import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor, withRateLimit } from "../context"

/** Body: { revision_id | null }. Builds a real preview of the head (or that revision). Nothing goes live. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await withRateLimit(res, async () => {
    res.status(202).json({ deployment: await designerFor(req).promote(req.body) })
  })
}
