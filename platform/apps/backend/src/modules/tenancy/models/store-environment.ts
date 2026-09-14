import { model } from "@medusajs/framework/utils"
import Organization from "./organization"
import ResourceOwnership from "./resource-ownership"
import Shopper from "./shopper"
import StoreEnvironmentMember from "./store-environment-member"

/**
 * The tenant trust boundary. Every merchant-facing read/write and every
 * shopper action is evaluated against exactly one StoreEnvironment that the
 * server resolved from trusted inputs (auth identity, publishable key binding,
 * verified hostname) — never from a client- or model-supplied id.
 */
const StoreEnvironment = model.define("tenancy_store_environment", {
  id: model.id({ prefix: "senv" }).primaryKey(),
  handle: model.text().unique(),
  name: model.text(),
  /** Normalised platform hostname, e.g. `maria-candles.shops.test`. */
  hostname: model.text().unique(),
  status: model.enum(["active", "suspended"]).default("active"),
  currency_code: model.text().default("eur"),
  locale: model.text().default("bg-BG"),
  organization: model.belongsTo(() => Organization, {
    mappedBy: "store_environments",
  }),
  ownerships: model.hasMany(() => ResourceOwnership, {
    mappedBy: "store_environment",
  }),
  members: model.hasMany(() => StoreEnvironmentMember, {
    mappedBy: "store_environment",
  }),
  shoppers: model.hasMany(() => Shopper, {
    mappedBy: "store_environment",
  }),
})

export default StoreEnvironment
