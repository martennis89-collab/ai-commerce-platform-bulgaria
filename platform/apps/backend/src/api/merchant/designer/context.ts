import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { merchantDesigner } from "../../../designer/service"
import { respondRateLimited } from "../../../storefront/rate-limits"
import type { ExecutionContext } from "../../../tenancy/context"
import type { MerchantRequest } from "../../../tenancy/merchant-guard"

export function executionContextOf(req: MedusaRequest): ExecutionContext {
  const ctx = (req as MerchantRequest).executionContext
  if (!ctx) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Missing execution context")
  }
  return ctx
}

export const designerFor = (req: MedusaRequest) => merchantDesigner(executionContextOf(req))

/** Runs a designer handler, answering rate-limit errors with 429 and a retry hint. */
export async function withRateLimit(res: MedusaResponse, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    if (!respondRateLimited(res as any, error)) {
      throw error
    }
  }
}
