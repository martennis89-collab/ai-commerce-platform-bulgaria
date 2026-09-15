import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { designerFor } from "../../context"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ session: await designerFor(req).getSession(req.params.id) })
}
