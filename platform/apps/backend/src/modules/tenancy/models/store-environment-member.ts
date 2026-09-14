import { model } from "@medusajs/framework/utils"
import StoreEnvironment from "./store-environment"

/** Merchant user ↔ StoreEnvironment. M0 allows exactly one environment per user. */
const StoreEnvironmentMember = model.define("tenancy_store_environment_member", {
  id: model.id({ prefix: "smem" }).primaryKey(),
  user_id: model.text().unique(),
  role: model.enum(["owner", "staff"]).default("owner"),
  store_environment: model.belongsTo(() => StoreEnvironment, {
    mappedBy: "members",
  }),
})

export default StoreEnvironmentMember
