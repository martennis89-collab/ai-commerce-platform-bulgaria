import { model } from "@medusajs/framework/utils"
import StorefrontProject from "./storefront-project"

/**
 * A single build/deploy of a StorefrontProject for one target. Preview and live
 * are separate targets; a new ready deployment supersedes the previous one of
 * the same target.
 */
const Deployment = model
  .define("storefront_deployment", {
    id: model.id({ prefix: "dpl" }).primaryKey(),
    /** Denormalised owner for isolation checks and routing. */
    store_environment_id: model.text(),
    target: model.enum(["preview", "live"]),
    status: model.enum(["queued", "building", "ready", "failed", "superseded"]).default("queued"),
    provider: model.text(),
    core_version: model.text(),
    hostname: model.text(),
    /** Snapshot of the server-built manifest the build received (contains only a public publishable key). */
    manifest: model.json().nullable(),
    artifact_ref: model.text().nullable(),
    url: model.text().nullable(),
    error: model.text().nullable(),
    started_at: model.dateTime().nullable(),
    finished_at: model.dateTime().nullable(),
    /** Durable execution lease (M2): only the holder of lease_token may complete the deployment. */
    lease_owner: model.text().nullable(),
    lease_token: model.text().nullable(),
    lease_expires_at: model.dateTime().nullable(),
    attempts: model.number().default(0),
    /** Idempotency key of the request (e.g. an AI tool call); one deployment per key. */
    request_key: model.text().unique().nullable(),
    /** Monotonic per-project request order (M3-D11); the newest ready deployment is decided by it. */
    sequence: model.number().nullable(),
    /** The storefront revision this deployment builds. */
    revision_id: model.text().nullable(),
    /** Merchant user who requested it, when a merchant did. */
    requested_by: model.text().nullable(),
    project: model.belongsTo(() => StorefrontProject, { mappedBy: "deployments" }),
  })
  .indexes([
    // @ts-ignore column inference for enum/text columns
    { on: ["store_environment_id", "target", "status"] },
    // @ts-ignore column inference
    { on: ["project_id", "target", "sequence"] },
  ])

export default Deployment
