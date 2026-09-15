import { model } from "@medusajs/framework/utils"
import Deployment from "./deployment"
import StorefrontRevision from "./storefront-revision"

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
  /**
   * Mirror of the current head revision's config (validated by @platform/storefront-schema).
   * Revisions are the source of truth (M3); this copy is kept for existing readers.
   */
  config: model.json(),
  active_theme: model.text().default("default"),
  status: model.enum(["active", "archived"]).default("active"),
  /** The current draft head revision (M3). Created lazily for pre-M3 projects. */
  head_revision_id: model.text().nullable(),
  /** The revision served by the newest ready preview deployment. */
  preview_revision_id: model.text().nullable(),
  /** Last allocated revision sequence (monotonic). */
  revision_sequence: model.number().default(0),
  /** Last allocated deployment sequence (monotonic, M3-D11). */
  deployment_sequence: model.number().default(0),
  deployments: model.hasMany(() => Deployment, { mappedBy: "project" }),
  revisions: model.hasMany(() => StorefrontRevision, { mappedBy: "project" }),
})

export default StorefrontProject
