import { model } from "@medusajs/framework/utils"
import { OWNED_RESOURCE_TYPES } from "./constants"
import StoreEnvironment from "./store-environment"

/**
 * Single-owner registry for Medusa commerce resources. The unique index on
 * (resource_type, resource_id) makes "a resource belongs to at most one
 * StoreEnvironment" a database-enforced invariant.
 */
const ResourceOwnership = model
  .define("tenancy_resource_ownership", {
    id: model.id({ prefix: "town" }).primaryKey(),
    resource_type: model.enum([...OWNED_RESOURCE_TYPES]),
    resource_id: model.text(),
    store_environment: model.belongsTo(() => StoreEnvironment, {
      mappedBy: "ownerships",
    }),
  })
  .indexes([
    { on: ["resource_type", "resource_id"], unique: true },
    // @ts-ignore relationship column inference
    { on: ["store_environment_id", "resource_type"] },
  ])

export default ResourceOwnership
