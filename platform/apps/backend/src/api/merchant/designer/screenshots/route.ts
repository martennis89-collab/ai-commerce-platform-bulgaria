import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { captureScreenshot } from "../../../../designer/screenshots"
import { executionContextOf, withRateLimit } from "../context"

/** Body: { deployment_id, viewport: "mobile" | "desktop" }. Captures the caller's own ready preview. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await withRateLimit(res, async () => {
    res.status(201).json({ screenshot: await captureScreenshot(executionContextOf(req), req.body) })
  })
}
