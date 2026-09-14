import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { MerchantRequest } from "../../../tenancy/merchant-guard"
import { merchantStorefront } from "../../../tenancy/merchant-storefront"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ctx = (req as MerchantRequest).executionContext
  if (!ctx) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Missing execution context")
  }
  res.json({ storefront: await merchantStorefront(ctx).getStorefront() })
}
