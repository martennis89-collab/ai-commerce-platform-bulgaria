/**
 * Promotion ↔ StoreEnvironment binding.
 *
 * Medusa evaluates every active *automatic* promotion against every cart on the
 * platform, and a promotion without rules matches everything. Code checks alone
 * therefore cannot isolate promotions. Every tenant promotion carries exactly
 * one rule `store_environment_id eq <owner>`, and the cart promotion context is
 * set server-side from the cart's ownership record (see workflows/hooks/tenancy-promotions.ts).
 * While a cart is being created, the owner of its sales channel's ownership record
 * is used; sales-channel visibility is never consulted.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

export const PROMOTION_ENVIRONMENT_ATTRIBUTE = "store_environment_id"
/** Context value for carts without an owner: matches no environment-bound promotion. */
export const UNOWNED_PROMOTION_CONTEXT = "__unowned_cart__"

const violation = (detail: string) =>
  new MedusaError(MedusaError.Types.NOT_ALLOWED, `Tenant isolation violation: ${detail}`)

type Binding = { state: "unbound" } | { state: "bound"; envId: string } | { state: "invalid" }

function bindingOf(promotion: any): Binding {
  const rules = (promotion.rules ?? []).filter(
    (r: any) => r.attribute === PROMOTION_ENVIRONMENT_ATTRIBUTE
  )
  if (!rules.length) {
    return { state: "unbound" }
  }
  const values = (rules[0].values ?? []).map((v: any) => v.value)
  if (rules.length !== 1 || rules[0].operator !== "eq" || values.length !== 1 || typeof values[0] !== "string") {
    return { state: "invalid" }
  }
  return { state: "bound", envId: values[0] }
}

async function loadPromotions(container: MedusaContainer, ids: string[]) {
  const promotionModule = container.resolve(Modules.PROMOTION)
  return promotionModule.listPromotions(
    { id: [...new Set(ids)] },
    { relations: ["rules", "rules.values"] }
  )
}

/** Automatic promotions must be bound to exactly one environment; any environment rule must be well-formed. */
export async function assertPromotionsSafelyScoped(container: MedusaContainer, ids: string[]) {
  if (!ids.length) {
    return
  }
  for (const promotion of await loadPromotions(container, ids)) {
    const binding = bindingOf(promotion)
    if (binding.state === "invalid") {
      throw violation("promotion has an invalid store environment rule")
    }
    if ((promotion as any).is_automatic && binding.state !== "bound") {
      throw violation("automatic promotions must be bound to exactly one store environment")
    }
  }
}

/** Trusted provisioning path: binds unbound promotions; refuses promotions bound elsewhere. */
export async function bindPromotionsToEnvironment(
  container: MedusaContainer,
  storeEnvironmentId: string,
  ids: string[]
) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) {
    return
  }
  const promotions = await loadPromotions(container, unique)
  if (promotions.length !== unique.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "promotion not found")
  }
  const promotionModule = container.resolve(Modules.PROMOTION)
  for (const promotion of promotions) {
    const binding = bindingOf(promotion)
    if (binding.state === "invalid" || (binding.state === "bound" && binding.envId !== storeEnvironmentId)) {
      throw violation("promotion is bound to another store environment")
    }
    if (binding.state === "unbound") {
      await promotionModule.addPromotionRules(promotion.id, [
        { attribute: PROMOTION_ENVIRONMENT_ATTRIBUTE, operator: "eq", values: [storeEnvironmentId] },
      ])
    }
  }
}
