/**
 * Tenant-scoped merchant commerce service.
 *
 * The only way to obtain one is from a server-built ExecutionContext, so every
 * method is implicitly bound to the caller's StoreEnvironment. Methods take
 * resource ids only; there is no parameter through which a tenant can be named.
 * Reads select explicit fields so Medusa's global objects (e.g. the cross-store
 * Customer) are never serialised to merchants.
 */
import {
  cancelOrderWorkflow,
  completeOrderWorkflow,
  deleteProductsWorkflow,
  updateInventoryLevelsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { ExecutionContext, requirePermission, tenantNotFound } from "./context"

export const PRODUCT_FIELDS = [
  "id",
  "title",
  "handle",
  "status",
  "variants.id",
  "variants.title",
  "variants.sku",
]

export const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "email",
  "currency_code",
  "total",
  "created_at",
  "items.id",
  "items.title",
  "items.variant_id",
  "items.quantity",
]

export type ProductUpdate = { title?: string; status?: "draft" | "published" }

export function merchantCommerce(ctx: ExecutionContext) {
  const scope = ctx.scope
  const container = scope.container
  const query = scope.query()

  async function graphOwned(entity: string, type: "product" | "order", fields: string[], id?: string) {
    const owned = await scope.ownedIds(type)
    const ids = id ? owned.filter((o) => o === id) : owned
    if (!ids.length) {
      return []
    }
    const { data } = await query.graph({ entity, fields, filters: { id: ids } })
    return data as any[]
  }

  const api = {
    // --- catalogue ----------------------------------------------------------
    async listProducts() {
      requirePermission(ctx, "catalogue:read")
      return graphOwned("product", "product", PRODUCT_FIELDS)
    },

    async getProduct(productId: string) {
      requirePermission(ctx, "catalogue:read")
      await scope.assertOwned("product", productId)
      const [product] = await graphOwned("product", "product", PRODUCT_FIELDS, productId)
      if (!product) {
        throw tenantNotFound("product")
      }
      return product
    },

    async updateProduct(productId: string, update: ProductUpdate) {
      requirePermission(ctx, "catalogue:write")
      await scope.assertOwned("product", productId)
      await updateProductsWorkflow(container).run({
        input: { selector: { id: productId }, update },
      })
      return api.getProduct(productId)
    },

    async archiveProduct(productId: string) {
      requirePermission(ctx, "catalogue:write")
      await scope.assertOwned("product", productId)
      await deleteProductsWorkflow(container).run({ input: { ids: [productId] } })
      return { id: productId, archived: true }
    },

    // --- orders -------------------------------------------------------------
    async listOrders() {
      requirePermission(ctx, "orders:read")
      return graphOwned("order", "order", ORDER_FIELDS)
    },

    async getOrder(orderId: string) {
      requirePermission(ctx, "orders:read")
      await scope.assertOwned("order", orderId)
      const [order] = await graphOwned("order", "order", ORDER_FIELDS, orderId)
      if (!order) {
        throw tenantNotFound("order")
      }
      return order
    },

    async cancelOrder(orderId: string) {
      requirePermission(ctx, "orders:write")
      await scope.assertOwned("order", orderId)
      await cancelOrderWorkflow(container).run({
        input: { order_id: orderId, canceled_by: ctx.user.id },
      })
      return api.getOrder(orderId)
    },

    async completeOrder(orderId: string) {
      requirePermission(ctx, "orders:write")
      await scope.assertOwned("order", orderId)
      await completeOrderWorkflow(container).run({ input: { orderIds: [orderId] } })
      return api.getOrder(orderId)
    },

    // --- inventory ----------------------------------------------------------
    async listInventoryLevels() {
      requirePermission(ctx, "inventory:read")
      const [items, locations] = await Promise.all([
        scope.ownedIds("inventory_item"),
        scope.ownedIds("stock_location"),
      ])
      if (!items.length || !locations.length) {
        return []
      }
      const inventory = container.resolve(Modules.INVENTORY)
      const levels = await inventory.listInventoryLevels(
        { inventory_item_id: items, location_id: locations },
        { take: null }
      )
      return levels.map((l: any) => ({
        inventory_item_id: l.inventory_item_id,
        location_id: l.location_id,
        stocked_quantity: Number(l.stocked_quantity),
        reserved_quantity: Number(l.reserved_quantity),
      }))
    },

    async getInventoryLevel(inventoryItemId: string, locationId: string) {
      requirePermission(ctx, "inventory:read")
      await scope.assertInventoryLevelOwned(inventoryItemId, locationId)
      const inventory = container.resolve(Modules.INVENTORY)
      const [level] = await inventory.listInventoryLevels({
        inventory_item_id: inventoryItemId,
        location_id: locationId,
      })
      if (!level) {
        throw tenantNotFound("inventory level")
      }
      return {
        inventory_item_id: level.inventory_item_id,
        location_id: level.location_id,
        stocked_quantity: Number(level.stocked_quantity),
        reserved_quantity: Number(level.reserved_quantity),
      }
    },

    async setStockedQuantity(inventoryItemId: string, locationId: string, stockedQuantity: number) {
      requirePermission(ctx, "inventory:write")
      if (!Number.isInteger(stockedQuantity) || stockedQuantity < 0) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "stocked_quantity must be a non-negative integer")
      }
      await scope.assertInventoryLevelOwned(inventoryItemId, locationId)
      await updateInventoryLevelsWorkflow(container).run({
        input: {
          updates: [
            { inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: stockedQuantity },
          ],
        },
      })
      return api.getInventoryLevel(inventoryItemId, locationId)
    },

    // --- shoppers -----------------------------------------------------------
    async listShoppers() {
      requirePermission(ctx, "shoppers:read")
      const shoppers = await scope.tenancy().listShoppers(
        { store_environment_id: scope.storeEnvironmentId },
        { take: null }
      )
      return Promise.all(shoppers.map((s: any) => withStats(s)))
    },

    async getShopper(shopperId: string) {
      requirePermission(ctx, "shoppers:read")
      const [shopper] = await scope.tenancy().listShoppers({
        id: shopperId,
        store_environment_id: scope.storeEnvironmentId,
      })
      if (!shopper) {
        throw tenantNotFound("shopper")
      }
      return withStats(shopper)
    },
  }

  /** Relationship metrics computed only from orders owned by this environment. */
  async function withStats(shopper: any) {
    const orders = (await graphOwned("order", "order", ["id", "email", "status", "total"])).filter(
      (o) => String(o.email).toLowerCase() === shopper.email
    )
    const counted = orders.filter((o) => o.status !== "canceled")
    return {
      id: shopper.id,
      email: shopper.email,
      created_at: shopper.created_at,
      order_count: counted.length,
      lifetime_value: counted.reduce((sum, o) => sum + Number(o.total ?? 0), 0),
      order_ids: orders.map((o) => o.id),
    }
  }

  return api
}

export type MerchantCommerce = ReturnType<typeof merchantCommerce>
