import type { MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { ExecutionContext } from "../../../tenancy/context"
import type { MerchantRequest } from "../../../tenancy/merchant-guard"

export function executionContextOf(req: MedusaRequest): ExecutionContext {
  const ctx = (req as MerchantRequest).executionContext
  if (!ctx) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Missing execution context")
  }
  return ctx
}
