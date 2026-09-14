import { model } from "@medusajs/framework/utils"
import Deployment from "./deployment"

/**
 * One merchant StoreEnvironment's independent storefront project (Level 3 §3–§4).
 * Exactly one project per environment; hostnames are unique platform-wide.
 */
const StorefrontProject = model.define("storefront_project", {
  id: model.id({ prefix: "sfp" }).primaryKey(),
  store_environment_id: model.text().unique(),
  handle: model.text().unique(),
  template: model.text().default("storefront-core"),
  /** storefront-core version this project is pinned to. */
  core_version: model.text(),
  deployment_provider: model.text(),
  /** Provider-specific project/repository reference (local: projects/<id>). */
  repository_ref: model.text(),
  /** The environment-owned publishable key builds receive. Verified on every deployment. */
  publishable_api_key_id: model.text(),
  preview_hostname: model.text().unique(),
  live_hostname: model.text().unique(),
  /** Draft storefront configuration (validated by @platform/storefront-schema). */
  config: model.json(),
  active_theme: model.text().default("default"),
  status: model.enum(["active", "archived"]).default("active"),
  deployments: model.hasMany(() => Deployment, { mappedBy: "project" }),
})

export default StorefrontProject
