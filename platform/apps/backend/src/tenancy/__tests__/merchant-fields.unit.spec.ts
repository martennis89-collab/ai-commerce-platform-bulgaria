import { ORDER_FIELDS, PRODUCT_FIELDS } from "../merchant-commerce"

/**
 * Medusa's Customer is one global row per email across all stores, and
 * `customer.orders` spans every merchant. Merchant-facing reads must never
 * traverse it (use the tenant-scoped Shopper instead), nor use wildcards that
 * could pull it in implicitly.
 */
describe("merchant read field allow-lists", () => {
  it.each([
    ["product", PRODUCT_FIELDS],
    ["order", ORDER_FIELDS],
  ])("%s fields never traverse global cross-store relations or use wildcards", (_name, fields) => {
    for (const field of fields) {
      expect(field).not.toMatch(/(^|\.)customer(\.|_id$|$)/)
      expect(field).not.toMatch(/\*/)
      expect(field).not.toMatch(/(^|\.)sales_channels?\./)
    }
  })
})
