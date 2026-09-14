import { model } from "@medusajs/framework/utils"

/** Platform staff allowed to use Medusa's native /admin API. Explicit allow-list. */
const PlatformOperator = model.define("tenancy_platform_operator", {
  id: model.id({ prefix: "pop" }).primaryKey(),
  user_id: model.text().unique(),
})

export default PlatformOperator
