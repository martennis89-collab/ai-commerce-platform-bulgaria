import { rejectsGlobalCustomerFields, stripGlobalCustomerFields } from "../storefront-policy"

describe("storefront global-customer exposure guard", () => {
  it.each([
    "+customer_id",
    "customer",
    "*customer",
    "+customer.email",
    "-customer",
    "+shipping_address.customer_id",
    "items.order.customer.id",
    " +customer_id ",
    "+id,+customer_id",
  ])("rejects field path %p", (fields) => {
    expect(rejectsGlobalCustomerFields({ fields })).toBe(true)
  })

  it("rejects array and object query forms", () => {
    expect(rejectsGlobalCustomerFields({ fields: ["+id", "+customer_id"] })).toBe(true)
    expect(rejectsGlobalCustomerFields({ fields: { x: "+customer.id" } })).toBe(true)
  })

  it.each(["+items", "*shipping_address", "+email", "customers_note", "+metadata"])(
    "allows unrelated field path %p",
    (fields) => {
      expect(rejectsGlobalCustomerFields({ fields })).toBe(false)
    }
  )

  it("strips customer keys at any depth without touching other data", () => {
    const body = {
      cart: { id: "cart_1", email: "test@example.com", customer_id: "cus_1", customer: { id: "cus_1" } },
      parent: { cart: { items: [{ id: "li_1", customer_id: "cus_1" }], customer: { id: "cus_1" } } },
      deleted: true,
    }
    const stripped = stripGlobalCustomerFields(body)
    expect(JSON.stringify(stripped)).not.toContain("cus_1")
    expect(stripped).toEqual({
      cart: { id: "cart_1", email: "test@example.com" },
      parent: { cart: { items: [{ id: "li_1" }] } },
      deleted: true,
    })
    expect(body.cart.customer_id).toBe("cus_1")
  })

  it("preserves values that serialise through toJSON (Medusa BigNumber totals, dates)", () => {
    class MoneyLike {
      constructor(private readonly v: number) {}
      toJSON() {
        return this.v
      }
    }
    const created = new Date("2026-09-14T00:00:00.000Z")
    const body = { order: { total: new MoneyLike(23), created_at: created, customer_id: "cus_1" } }
    expect(stripGlobalCustomerFields(body)).toEqual(JSON.parse(JSON.stringify({ order: { total: 23, created_at: created } })))
  })
})
