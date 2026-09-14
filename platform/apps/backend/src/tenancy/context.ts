import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { TENANCY_MODULE } from "../modules/tenancy"
import type { OwnedResourceType } from "../modules/tenancy/models"
import type TenancyModuleService from "../modules/tenancy/service"

/**
 * Only code in this file can mint a TenantScope. Every TenantScope therefore
 * originates from one of the trusted resolvers below (authenticated merchant
 * membership, server-side publishable-key binding, or a workflow deriving the
 * owner of an already-owned resource). There is no public constructor that
 * accepts a caller-chosen store_environment_id.
 */
const MINT = Symbol("tenant-scope-mint")

export const tenantNotFound = (what: string) =>
  new MedusaError(MedusaError.Types.NOT_FOUND, `${what} not found`)

export class TenantScope {
  readonly storeEnvironmentId: string
  readonly #container: MedusaContainer

  constructor(mint: symbol, storeEnvironmentId: string, container: MedusaContainer) {
    if (mint !== MINT) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "TenantScope can only be created by a trusted tenant resolver"
      )
    }
    this.storeEnvironmentId = storeEnvironmentId
    this.#container = container
    Object.freeze(this)
  }

  get container() {
    return this.#container
  }

  tenancy(): TenancyModuleService {
    return this.#container.resolve(TENANCY_MODULE)
  }

  query() {
    return this.#container.resolve(ContainerRegistrationKeys.QUERY)
  }

  async ownedIds(type: OwnedResourceType): Promise<string[]> {
    return this.tenancy().listOwnedResourceIds(this.storeEnvironmentId, type)
  }

  /** Throws NOT_FOUND (never "forbidden") so foreign ids are indistinguishable from missing ones. */
  async assertOwned(type: OwnedResourceType, ids: string | string[]): Promise<void> {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((i) => i !== undefined)
    if (!list.length) {
      return
    }
    if (list.some((id) => typeof id !== "string" || !id)) {
      throw tenantNotFound(type)
    }
    const owners = await this.tenancy().getOwners(type, list)
    for (const id of list) {
      if (owners.get(id) !== this.storeEnvironmentId) {
        throw tenantNotFound(type)
      }
    }
  }

  async assertVariantsOwned(variantIds: string[]): Promise<void> {
    const ids = [...new Set(variantIds.filter((v) => v !== undefined))]
    if (!ids.length) {
      return
    }
    if (ids.some((id) => typeof id !== "string")) {
      throw tenantNotFound("variant")
    }
    const { data } = await this.query().graph({
      entity: "product_variant",
      fields: ["id", "product_id"],
      filters: { id: ids },
      withDeleted: true,
    })
    if (data.length !== ids.length) {
      throw tenantNotFound("variant")
    }
    await this.assertOwned(
      "product",
      data.map((v: any) => v.product_id)
    ).catch(() => {
      throw tenantNotFound("variant")
    })
  }

  async assertPromotionCodesOwned(codes: string[]): Promise<void> {
    const list = [...new Set(codes.filter((c) => c !== undefined))]
    if (!list.length) {
      return
    }
    const promotionModule = this.#container.resolve(Modules.PROMOTION)
    const promotions = await promotionModule.listPromotions(
      { code: list },
      { select: ["id", "code"] }
    )
    if (promotions.length !== list.length) {
      throw tenantNotFound("promotion")
    }
    await this.assertOwned(
      "promotion",
      promotions.map((p) => p.id)
    ).catch(() => {
      throw tenantNotFound("promotion")
    })
  }

  async assertPaymentCollectionOwned(paymentCollectionId: string): Promise<string> {
    const { data } = await this.query().graph({
      entity: "cart_payment_collection",
      fields: ["cart_id", "payment_collection_id"],
      filters: { payment_collection_id: paymentCollectionId },
    })
    if (data.length !== 1) {
      throw tenantNotFound("payment collection")
    }
    await this.assertOwned("cart", data[0].cart_id).catch(() => {
      throw tenantNotFound("payment collection")
    })
    return data[0].cart_id
  }

  async assertLineItemInOwnedCart(cartId: string, lineItemId: string) {
    await this.assertOwned("cart", cartId)
    const cartModule = this.#container.resolve(Modules.CART)
    const items = await cartModule.listLineItems({ id: lineItemId, cart_id: cartId })
    if (!items.length) {
      throw tenantNotFound("line item")
    }
  }

  async assertInventoryLevelOwned(inventoryItemId: string, locationId: string) {
    await this.assertOwned("inventory_item", inventoryItemId)
    await this.assertOwned("stock_location", locationId)
  }

  claim(type: OwnedResourceType, ids: string[]) {
    return this.tenancy().claimResources(this.storeEnvironmentId, type, ids)
  }
}

// ---------------------------------------------------------------------------
// Trusted resolvers
// ---------------------------------------------------------------------------

async function loadActiveEnvironment(container: MedusaContainer, storeEnvironmentId: string) {
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  const [env] = await tenancy.listStoreEnvironments({ id: storeEnvironmentId })
  if (!env || env.status !== "active") {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "Store environment is not available")
  }
  return env
}

/**
 * Storefront (shopper) context: the publishable key's server-side ownership
 * record decides the environment. The key's sales channels must all be owned by
 * that same environment, otherwise the configuration is treated as corrupt and
 * the request fails closed.
 */
export async function resolveStorefrontScope(
  container: MedusaContainer,
  publishableKeyToken: string | undefined
): Promise<TenantScope> {
  const denied = new MedusaError(
    MedusaError.Types.FORBIDDEN,
    "Storefront is not bound to a store environment"
  )
  if (!publishableKeyToken) {
    throw denied
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "type", "revoked_at", "sales_channels_link.sales_channel_id"],
    filters: { token: publishableKeyToken, type: "publishable" },
  })
  const key = keys[0] as any
  if (!key || (key.revoked_at && new Date(key.revoked_at) <= new Date())) {
    throw denied
  }
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  const owner = (await tenancy.getOwners("api_key", [key.id])).get(key.id)
  if (!owner) {
    throw denied
  }
  const salesChannelIds: string[] = (key.sales_channels_link ?? []).map(
    (l: any) => l.sales_channel_id
  )
  const channelOwners = await tenancy.getOwners("sales_channel", salesChannelIds)
  if (!salesChannelIds.length || salesChannelIds.some((id) => channelOwners.get(id) !== owner)) {
    throw denied
  }
  await loadActiveEnvironment(container, owner)
  return new TenantScope(MINT, owner, container)
}

export const MERCHANT_ROLE_PERMISSIONS = {
  owner: [
    "catalogue:read",
    "catalogue:write",
    "orders:read",
    "orders:write",
    "inventory:read",
    "inventory:write",
    "shoppers:read",
  ],
  staff: ["catalogue:read", "orders:read", "orders:write", "inventory:read", "inventory:write"],
} as const

export type Permission = (typeof MERCHANT_ROLE_PERMISSIONS)["owner"][number]

/** Level 3 §1.3 ExecutionContext. Built only by the server; immutable. */
export type ExecutionContext = Readonly<{
  user: Readonly<{ id: string }>
  organization: Readonly<{ id: string }>
  store_environment: Readonly<{ id: string; handle: string; name: string }>
  permissions: readonly Permission[]
  current_page: string | null
  selected_entity: Readonly<{ type: string; id: string }> | null
  scope: TenantScope
}>

export function requirePermission(ctx: ExecutionContext, permission: Permission) {
  if (!ctx.permissions.includes(permission)) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, `Missing permission ${permission}`)
  }
}

/**
 * Merchant context from an authenticated Medusa user id (taken from the
 * verified JWT/session, never from the request body). The environment is the
 * user's membership; there is no way to ask for a different one.
 */
export async function buildMerchantExecutionContext(
  container: MedusaContainer,
  authenticatedUserId: string | undefined,
  hints: { current_page?: string | null } = {}
): Promise<ExecutionContext> {
  if (!authenticatedUserId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  const memberships = await tenancy.listStoreEnvironmentMembers({
    user_id: authenticatedUserId,
  })
  if (memberships.length !== 1) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "No merchant store environment")
  }
  const membership = memberships[0] as any
  const env = await loadActiveEnvironment(container, membership.store_environment_id)
  const permissions = MERCHANT_ROLE_PERMISSIONS[membership.role as "owner" | "staff"] ?? []
  return Object.freeze({
    user: Object.freeze({ id: authenticatedUserId }),
    organization: Object.freeze({ id: (env as any).organization_id }),
    store_environment: Object.freeze({ id: env.id, handle: env.handle, name: env.name }),
    permissions: Object.freeze([...permissions]),
    current_page: typeof hints.current_page === "string" ? hints.current_page.slice(0, 200) : null,
    selected_entity: null,
    scope: new TenantScope(MINT, env.id, container),
  })
}

/**
 * Workflow-internal scope: the environment is derived from the persisted owner
 * of a resource (e.g. the cart being mutated). Returns null when the resource is
 * unowned, which callers must treat as a denial.
 */
export async function deriveScopeFromOwnedResource(
  container: MedusaContainer,
  type: OwnedResourceType,
  resourceId: string | undefined | null
): Promise<TenantScope | null> {
  if (!resourceId) {
    return null
  }
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  const owner = (await tenancy.getOwners(type, [resourceId])).get(resourceId)
  return owner ? new TenantScope(MINT, owner, container) : null
}

/**
 * Platform provisioning only (creating a brand new environment's resources).
 * Callable from trusted server code paths such as the provisioning script and
 * test fixtures; never wired to any HTTP input.
 */
export function provisioningScope(container: MedusaContainer, storeEnvironmentId: string) {
  return new TenantScope(MINT, storeEnvironmentId, container)
}
