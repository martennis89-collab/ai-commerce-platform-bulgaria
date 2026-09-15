import { model } from "@medusajs/framework/utils"

/** A merchant-uploaded photo (D2). The file itself is claimed as tenancy `media_file`. */
const MediaAsset = model
  .define("ai_media_asset", {
    id: model.id({ prefix: "media" }).primaryKey(),
    store_environment_id: model.text(),
    file_id: model.text().unique(),
    url: model.text(),
    mime_type: model.text(),
    size_bytes: model.number(),
    sha256: model.text(),
    original_name: model.text().nullable(),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["store_environment_id"] },
  ])

export default MediaAsset
