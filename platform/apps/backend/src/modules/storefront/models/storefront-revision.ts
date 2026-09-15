import { model } from "@medusajs/framework/utils"
import StorefrontProject from "./storefront-project"

/**
 * An immutable, versioned storefront configuration (Level 3 §4, M3).
 *
 * Revisions are append-only: the config of a revision never changes. Editing
 * creates a new revision whose parent is the project's current head; undo and
 * restore create a new revision copying an earlier one. Only `state` moves:
 * draft → preview (currently promoted to a preview deployment) → superseded.
 * `published` is reserved for live publishing, which M3 does not do.
 */
const StorefrontRevision = model
  .define("storefront_revision", {
    id: model.id({ prefix: "srev" }).primaryKey(),
    store_environment_id: model.text(),
    /** Monotonic per project (1, 2, 3 …), shown to merchants as "Версия n". */
    sequence: model.number(),
    parent_revision_id: model.text().nullable(),
    state: model.enum(["draft", "preview", "published", "superseded"]).default("draft"),
    schema_version: model.number(),
    /** Validated storefront-schema config; never updated after insert. */
    config: model.json(),
    author_type: model.enum(["system", "merchant", "ai"]),
    author_user_id: model.text().nullable(),
    /** Idempotency key of the AI tool call that created it; one revision per key. */
    action_key: model.text().unique().nullable(),
    designer_message_id: model.text().nullable(),
    restored_from_revision_id: model.text().nullable(),
    /** Short Bulgarian summary of the change. */
    summary: model.text(),
    project: model.belongsTo(() => StorefrontProject, { mappedBy: "revisions" }),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["project_id", "sequence"], unique: true },
    // @ts-ignore column inference
    { on: ["store_environment_id", "created_at"] },
  ])

export default StorefrontRevision
