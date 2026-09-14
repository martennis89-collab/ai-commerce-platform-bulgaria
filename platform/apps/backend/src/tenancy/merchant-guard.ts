/**
 * Merchant / operator request boundaries.
 *
 * - `/merchant/*` is the only merchant-facing commerce API. Tenant context is
 *   built from the verified user identity; client tenant selectors are rejected.
 * - `/admin/*` (Medusa's native, tenant-unaware admin API) is restricted to an
 *   explicit platform-operator allow-list. Merchant users can never reach it.
 * - `/auth/customer/*` is disabled: Medusa customer accounts are global across
 *   stores, and M0 is guest checkout only.
 */
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { TENANCY_MODULE } from "../modules/tenancy"
import type TenancyModuleService from "../modules/tenancy/service"
import { buildMerchantExecutionContext, ExecutionContext } from "./context"
import { merchantCommerce } from "./merchant-commerce"
import { findTenantSelectorHeaders, findTenantSelectors } from "./selectors"

export type MerchantRequest = MedusaRequest & { executionContext?: ExecutionContext }

export async function merchantExecutionContextMiddleware(
  req: MerchantRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    if (req.method.toUpperCase() === "OPTIONS") {
      return next()
    }
    const auth = (req as any).auth_context
    if (!auth || auth.actor_type !== "user" || !auth.actor_id) {
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
    }
    if (
      findTenantSelectorHeaders(req.headers as any).length ||
      findTenantSelectors(req.body).length ||
      findTenantSelectors(req.query).length
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Tenant context is established by the server and cannot be supplied by the client"
      )
    }
    req.executionContext = await buildMerchantExecutionContext(req.scope, auth.actor_id, {
      current_page: typeof req.headers["x-current-page"] === "string" ? req.headers["x-current-page"] : null,
    })
    return next()
  } catch (e) {
    return next(e)
  }
}

export function commerceFor(req: MedusaRequest) {
  const ctx = (req as MerchantRequest).executionContext
  if (!ctx) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Missing execution context")
  }
  return merchantCommerce(ctx)
}

export async function adminOperatorOnly(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    if (req.method.toUpperCase() === "OPTIONS") {
      return next()
    }
    const auth = (req as any).auth_context
    if (!auth?.actor_id || auth.actor_type !== "user") {
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
    }
    const tenancy: TenancyModuleService = req.scope.resolve(TENANCY_MODULE)
    const operators = await tenancy.listPlatformOperators({ user_id: auth.actor_id })
    if (!operators.length) {
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "The native admin API is restricted to platform operators"
      )
    }
    return next()
  } catch (e) {
    return next(e)
  }
}

export async function denyCustomerAccounts(
  _req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  next(
    new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "Customer accounts are not enabled; storefronts use tenant-scoped guest checkout"
    )
  )
}
