import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import type { MerchantRequest } from "../../../../tenancy/merchant-guard"
import { merchantStorefront } from "../../../../tenancy/merchant-storefront"

/** No parameters: the project, environment and publishable key are all server-derived. */
const RequestPreviewDeployment = z.strictObject({})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const ctx = (req as MerchantRequest).executionContext
  if (!ctx) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Missing execution context")
  }
  if (!RequestPreviewDeployment.safeParse(req.body ?? {}).success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Preview deployments take no parameters")
  }
  res.status(202).json({ deployment: await merchantStorefront(ctx).requestPreviewDeployment() })
}
