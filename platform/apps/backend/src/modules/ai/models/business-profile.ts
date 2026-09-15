import { model } from "@medusajs/framework/utils"

/** Merchant business profile for one StoreEnvironment (Level 3 §3). */
const BusinessProfile = model.define("ai_business_profile", {
  id: model.id({ prefix: "bprof" }).primaryKey(),
  store_environment_id: model.text().unique(),
  description: model.text().nullable(),
  /** Merchant-provided facts only. */
  facts: model.json().nullable(),
  /** Latest applied brand proposal (AI inference / recommendation, see provenance). */
  brand: model.json().nullable(),
  language: model.text().default("bg-BG"),
})

export default BusinessProfile
