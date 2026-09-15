import { model } from "@medusajs/framework/utils"

/**
 * Visual evidence of a built preview (M3-D7): a PNG captured by headless
 * Chromium from one ready preview deployment's own artifact. The image is a
 * tenant-owned media file.
 */
const StorefrontScreenshot = model
  .define("storefront_screenshot", {
    id: model.id({ prefix: "sshot" }).primaryKey(),
    store_environment_id: model.text(),
    project_id: model.text(),
    deployment_id: model.text(),
    revision_id: model.text().nullable(),
    viewport: model.enum(["mobile", "desktop"]),
    width: model.number(),
    height: model.number(),
    file_id: model.text().unique(),
    url: model.text(),
    size_bytes: model.number(),
    requested_by: model.text(),
  })
  .indexes([
    // @ts-ignore column inference
    { on: ["store_environment_id", "created_at"] },
    // @ts-ignore column inference
    { on: ["deployment_id"] },
  ])

export default StorefrontScreenshot
