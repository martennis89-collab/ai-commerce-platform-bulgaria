import { model } from "@medusajs/framework/utils"
import StoreEnvironment from "./store-environment"

/**
 * Tenant-scoped shopper relationship. The same natural person (email) has an
 * independent Shopper row per StoreEnvironment. Medusa's global Customer record
 * is an internal implementation detail and is never exposed to merchants.
 */
const Shopper = model
  .define("tenancy_shopper", {
    id: model.id({ prefix: "shop" }).primaryKey(),
    email: model.text(),
    /** Internal pointer to Medusa's global (cross-store) customer row. Never exposed. */
    medusa_customer_id: model.text().nullable(),
    store_environment: model.belongsTo(() => StoreEnvironment, {
      mappedBy: "shoppers",
    }),
  })
  .indexes([
    // @ts-ignore relationship column inference
    { on: ["store_environment_id", "email"], unique: true },
  ])

export default Shopper
