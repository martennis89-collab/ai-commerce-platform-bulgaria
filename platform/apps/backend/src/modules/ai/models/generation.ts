import { model } from "@medusajs/framework/utils"

/**
 * A generated artifact with provenance (ADR-013): every field is marked as a
 * merchant-provided fact, an AI inference, or a recommendation.
 */
const Generation = model.define("ai_generation", {
  id: model.id({ prefix: "gen" }).primaryKey(),
  store_environment_id: model.text(),
  run_id: model.text(),
  task_id: model.text().nullable(),
  kind: model.enum([
    "business_profile",
    "brand",
    "product_draft",
    "image_attachment",
    "storefront_config",
    "offer_suggestion",
  ]),
  status: model.enum(["proposed", "applied", "rejected", "superseded"]).default("proposed"),
  payload: model.json(),
  provenance: model.json(),
  resource_type: model.text().nullable(),
  resource_id: model.text().nullable(),
})

export default Generation
