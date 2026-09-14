import { model } from "@medusajs/framework/utils"
import StoreEnvironment from "./store-environment"

const Organization = model.define("tenancy_organization", {
  id: model.id({ prefix: "org" }).primaryKey(),
  name: model.text(),
  store_environments: model.hasMany(() => StoreEnvironment, {
    mappedBy: "organization",
  }),
})

export default Organization
