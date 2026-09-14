/**
 * Workflow-level tenant invariants (defence in depth below the HTTP layer).
 *
 * These hooks enforce context-free data invariants inside Medusa's own cart
 * workflows, so they hold for every caller — Store API routes, future merchant
 * or AI tool services, subscribers, scripts — not just for the routes the
 * storefront policy guards:
 *
 *   - a cart is owned by the environment that owns its sales channel;
 *   - everything placed in a cart (variants, shipping options, promotions)
 *     is owned by the cart's environment;
 *   - a cart can never be moved to another environment's sales channel;
 *   - a cart can only complete if all of the above still hold;
 *   - the resulting order is owned by the cart's environment and recorded
 *     against a tenant-scoped Shopper.
 *
 * The environment is always derived from persisted ownership records, never
 * from workflow input.
 */
import {
  addShippingMethodToCartWorkflow,
  addToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  transferCartCustomerWorkflow,
  updateCartPromotionsWorkflow,
  updateCartWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/medusa/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { deriveScopeFromOwnedResource, TenantScope } from "../../tenancy/context"
import { TENANCY_MODULE } from "../../modules/tenancy"
import type TenancyModuleService from "../../modules/tenancy/service"

const violation = (detail: string) =>
  new MedusaError(MedusaError.Types.NOT_ALLOWED, `Tenant isolation violation: ${detail}`)

async function guard(promise: Promise<unknown>, detail: string) {
  try {
    await promise
  } catch {
    throw violation(detail)
  }
}

/** Scope of an existing cart: must be owned, and its sales channel must share the owner. */
async function ownedCartScope(container: MedusaContainer, cart: any): Promise<TenantScope> {
  const scope = await deriveScopeFromOwnedResource(container, "cart", cart?.id)
  if (!scope) {
    throw violation("cart is not owned by a store environment")
  }
  if (cart.sales_channel_id !== undefined) {
    await guard(
      scope.assertOwned("sales_channel", cart.sales_channel_id),
      "cart sales channel belongs to another store environment"
    )
  }
  return scope
}

createCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const salesChannelId = (cart as any)?.sales_channel_id ?? (input as any)?.sales_channel_id
  const scope = await deriveScopeFromOwnedResource(container, "sales_channel", salesChannelId)
  if (!scope) {
    throw violation("cart sales channel is not owned by a store environment")
  }
  const variantIds = [
    ...((cart as any)?.items ?? []),
    ...((input as any)?.items ?? []),
  ]
    .map((i: any) => i.variant_id)
    .filter(Boolean)
  await guard(scope.assertVariantsOwned(variantIds), "variant belongs to another store environment")
})

createCartWorkflow.hooks.cartCreated(
  async ({ cart }, { container }) => {
    const scope = await deriveScopeFromOwnedResource(
      container,
      "sales_channel",
      (cart as any).sales_channel_id
    )
    if (!scope) {
      throw violation("cart sales channel is not owned by a store environment")
    }
    const claimed = await scope.claim("cart", [(cart as any).id])
    return new StepResponse(undefined, claimed)
  },
  async (claimed: string[] | undefined, { container }) => {
    if (claimed?.length) {
      const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
      await tenancy.releaseResources("cart", claimed)
    }
  }
)

updateCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const scope = await ownedCartScope(container, cart)
  const nextChannel = (input as any)?.sales_channel_id
  if (nextChannel) {
    await guard(
      scope.assertOwned("sales_channel", nextChannel),
      "cannot move cart to another store environment's sales channel"
    )
  }
})

addToCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const scope = await ownedCartScope(container, cart)
  const variantIds = ((input as any).items ?? []).map((i: any) => i.variant_id)
  if (variantIds.some((v: unknown) => !v)) {
    throw violation("custom line items without a tenant-owned variant are not allowed")
  }
  await guard(scope.assertVariantsOwned(variantIds), "variant belongs to another store environment")
})

updateLineItemInCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  await ownedCartScope(container, cart)
})

addShippingMethodToCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const scope = await ownedCartScope(container, cart)
  const optionIds = ((input as any).options ?? []).map((o: any) => o.id)
  await guard(
    scope.assertOwned("shipping_option", optionIds),
    "shipping option belongs to another store environment"
  )
})

updateCartPromotionsWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const codes: string[] = (input as any).promo_codes ?? []
  if ((input as any).action === "remove" || !codes.length) {
    return
  }
  // During cart creation this nested workflow runs before `cartCreated` claims
  // the cart, so fall back to the (owned) sales channel of the cart being built.
  const scope =
    (await deriveScopeFromOwnedResource(container, "cart", (cart as any)?.id)) ??
    (await deriveScopeFromOwnedResource(container, "sales_channel", (cart as any)?.sales_channel_id))
  if (!scope) {
    throw violation("cart is not owned by a store environment")
  }
  await guard(scope.assertPromotionCodesOwned(codes), "promotion belongs to another store environment")
})

transferCartCustomerWorkflow.hooks.validate(async () => {
  // Medusa customer accounts are global across all stores; M0 is guest checkout only.
  throw violation("customer accounts are not tenant-scoped; guest checkout only")
})

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const c: any = cart
  const scope = await ownedCartScope(container, c)
  const items: any[] = c.items ?? []
  if (items.some((i) => !i.variant_id)) {
    throw violation("custom line items without a tenant-owned variant are not allowed")
  }
  await guard(
    scope.assertVariantsOwned(items.map((i) => i.variant_id)),
    "cart contains a variant belonging to another store environment"
  )
  const optionIds = (c.shipping_methods ?? [])
    .map((m: any) => m.shipping_option_id)
    .filter(Boolean)
  await guard(
    scope.assertOwned("shipping_option", optionIds),
    "cart shipping method belongs to another store environment"
  )
  const promotionIds = [
    ...items.flatMap((i) => (i.adjustments ?? []).map((a: any) => a.promotion_id)),
    ...(c.shipping_methods ?? []).flatMap((m: any) =>
      (m.adjustments ?? []).map((a: any) => a.promotion_id)
    ),
  ].filter(Boolean)
  await guard(
    scope.assertOwned("promotion", promotionIds),
    "cart promotion belongs to another store environment"
  )
})

// `orderCreated` exists at runtime but is marked @ignore in Medusa's typings;
// the M0 suite asserts it fires (order ownership + Shopper) so an upgrade that
// removes it fails loudly rather than silently leaving orders unowned (fail closed).
;(completeCartWorkflow.hooks as any).orderCreated(
  async ({ order_id, cart_id }, { container }) => {
    const scope = await deriveScopeFromOwnedResource(container, "cart", cart_id)
    if (!scope) {
      throw violation("cart is not owned by a store environment")
    }
    const claimed = await scope.claim("order", [order_id])

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "email", "customer_id"],
      filters: { id: order_id },
    })
    const order: any = data[0]
    const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
    let createdShopperId: string | undefined
    if (order?.email) {
      const email = String(order.email).trim().toLowerCase()
      const [existing] = await tenancy.listShoppers({
        store_environment_id: scope.storeEnvironmentId,
        email,
      })
      if (!existing) {
        const shopper = await tenancy.createShoppers({
          store_environment_id: scope.storeEnvironmentId,
          email,
          medusa_customer_id: order.customer_id ?? null,
        })
        createdShopperId = shopper.id
      }
    }
    return new StepResponse(undefined, { claimed, createdShopperId })
  },
  async (comp: { claimed: string[]; createdShopperId?: string } | undefined, { container }) => {
    if (!comp) {
      return
    }
    const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
    if (comp.claimed?.length) {
      await tenancy.releaseResources("order", comp.claimed)
    }
    if (comp.createdShopperId) {
      await tenancy.deleteShoppers(comp.createdShopperId)
    }
  }
)
