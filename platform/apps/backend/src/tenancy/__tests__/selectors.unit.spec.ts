import { findTenantSelectorHeaders, findTenantSelectors, isForbiddenTenantKey } from "../selectors"

describe("tenant selector detection", () => {
  it.each([
    "store_environment_id",
    "storeEnvironmentId",
    "STORE-ENVIRONMENT-ID",
    "tenant_id",
    "organization_id",
    "store_environment",
  ])("flags %s", (key) => {
    expect(isForbiddenTenantKey(key)).toBe(true)
  })

  it.each(["product_id", "cart_id", "sales_channel_id", "region_id", "email"])("allows %s", (key) => {
    expect(isForbiddenTenantKey(key)).toBe(false)
  })

  it("finds selectors nested anywhere in a payload", () => {
    expect(
      findTenantSelectors({
        items: [{ variant_id: "v", metadata: { store_environment_id: "senv_b" } }],
      })
    ).toEqual(["$.items[0].metadata.store_environment_id"])
    expect(findTenantSelectors({ "filters[tenant_id]": "x" })).toEqual(["$.filters[tenant_id]"])
    expect(findTenantSelectors({ variant_id: "v", quantity: 1 })).toEqual([])
  })

  it("finds selector headers", () => {
    expect(findTenantSelectorHeaders({ "x-store-environment-id": "senv_b", host: "x" })).toEqual([
      "x-store-environment-id",
    ])
  })
})
