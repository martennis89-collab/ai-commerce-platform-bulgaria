import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listMerchantMedia, uploadMerchantMedia } from "../../../ai/media"
import { executionContextOf } from "../ai/context"

/** Merchant photo upload (D2): JSON body { filename, mime_type, content_base64 }. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.status(201).json({ media: await uploadMerchantMedia(executionContextOf(req), req.body ?? {}) })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ media: await listMerchantMedia(executionContextOf(req)) })
}
