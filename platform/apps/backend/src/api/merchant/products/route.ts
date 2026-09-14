import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { commerceFor } from "../../../tenancy/merchant-guard"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ products: await commerceFor(req).listProducts() })
}
