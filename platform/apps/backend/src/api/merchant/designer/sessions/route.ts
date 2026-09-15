import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor } from "../context"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.status(201).json({ session: await designerFor(req).createSession() })
}
