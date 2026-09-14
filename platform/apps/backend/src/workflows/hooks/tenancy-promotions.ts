/**
 * Promotion tenant scoping (independent M0 review finding MI-1).
 *
 * - Cart promotion evaluation always receives `store_environment_id` derived
 *   server-side from the cart's owner (or, while the cart is being created, its
 *   owned sales channel's owner). Environment-bound promotions of other stores
 *   can therefore never match, including automatic ones.
 * - Creating or updating an automatic promotion that is not bound to exactly one
 *   environment is rejected, so no platform-wide automatic promotion can exist
 *   via workflows.
 */
import {
  createPromotionsWorkflow,
  updateCartPromotionsWorkflow,
  updatePromotionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { deriveScopeFromOwnedResource } from "../../tenancy/context"
import {
  assertPromotionsSafelyScoped,
  PROMOTION_ENVIRONMENT_ATTRIBUTE,
  UNOWNED_PROMOTION_CONTEXT,
} from "../../tenancy/promotions"

updateCartPromotionsWorkflow.hooks.setPromotionContext(async ({ cart }, { container }) => {
  const c: any = cart
  const scope =
    (await deriveScopeFromOwnedResource(container, "cart", c?.id)) ??
    (await deriveScopeFromOwnedResource(container, "sales_channel", c?.sales_channel_id))
  return new StepResponse({
    [PROMOTION_ENVIRONMENT_ATTRIBUTE]: scope?.storeEnvironmentId ?? UNOWNED_PROMOTION_CONTEXT,
  })
})

createPromotionsWorkflow.hooks.promotionsCreated(async ({ promotions }, { container }) => {
  await assertPromotionsSafelyScoped(
    container,
    ((promotions as any[]) ?? []).map((p) => p.id)
  )
})

updatePromotionsWorkflow.hooks.promotionsUpdated(async ({ promotions }, { container }) => {
  await assertPromotionsSafelyScoped(
    container,
    ((promotions as any[]) ?? []).map((p) => p.id)
  )
})
