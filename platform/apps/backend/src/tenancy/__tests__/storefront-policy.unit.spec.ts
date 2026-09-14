import fs from "fs"
import path from "path"
import { matchStorefrontPolicy, STOREFRONT_ROUTE_POLICIES } from "../storefront-policy"

function coreStoreRoutes(): { method: string; path: string }[] {
  const root = path.dirname(require.resolve("@medusajs/medusa/package.json"))
  const apiDir = path.join(root, "dist", "api")
  const routes: { method: string; path: string }[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name === "route.js") {
        const source = fs.readFileSync(full, "utf8")
        const routePath =
          "/" +
          path
            .relative(apiDir, dir)
            .split(path.sep)
            .map((s) => (s.startsWith("[") ? `:${s.slice(1, -1)}` : s))
            .join("/")
        for (const method of ["GET", "POST", "DELETE"]) {
          if (source.includes(`exports.${method} =`)) {
            routes.push({ method, path: routePath })
          }
        }
      }
    }
  }
  walk(path.join(apiDir, "store"))
  return routes
}

const CART = "cart_01M2EK8A2E0K44AX3V5XH27XRG"
const PROD = "prod_01M2EK8A2E4ZJB6X2VGVNXF9GH"

describe("storefront route policy (deny-by-default)", () => {
  const core = coreStoreRoutes()

  it("discovers Medusa's core Store API routes", () => {
    expect(core.length).toBeGreaterThan(40)
  })

  it("every classified policy corresponds to a real Medusa Store route and states its rule", () => {
    for (const p of STOREFRONT_ROUTE_POLICIES) {
      expect(core).toContainEqual({ method: p.method, path: p.path })
      expect(p.rule.length).toBeGreaterThan(10)
    }
  })

  it("every unclassified core Store route is denied", () => {
    const classified = new Set(STOREFRONT_ROUTE_POLICIES.map((p) => `${p.method} ${p.path}`))
    const denied = core.filter((r) => !classified.has(`${r.method} ${r.path}`))
    expect(denied.length).toBeGreaterThan(20)
    for (const r of denied) {
      const concrete = r.path.replace(/:[a-z_]+/g, CART)
      expect(matchStorefrontPolicy(r.method, concrete)).toBeNull()
    }
    expect(denied.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        "GET /store/customers/me",
        "GET /store/product-variants/:id",
        "POST /store/carts/:id/customer",
        "GET /store/orders",
      ])
    )
  })

  it("matches like Express (case-insensitive, optional trailing slash) and extracts params", () => {
    const m = matchStorefrontPolicy("POST", `/STORE/carts/${CART}/line-items/`)
    expect(m?.policy.path).toBe("/store/carts/:id/line-items")
    expect(m?.params).toEqual({ id: CART })
    expect(matchStorefrontPolicy("HEAD", `/store/products/${PROD}`)?.params).toEqual({ id: PROD })
    expect(matchStorefrontPolicy("PUT", `/store/carts/${CART}`)).toBeNull()
    expect(matchStorefrontPolicy("GET", `/store/carts/${CART}/b`)).toBeNull()
    expect(matchStorefrontPolicy("GET", "/store/products/%E0%A4%A")).toBeNull()
  })

  it("only treats Medusa entity ids as path params (static siblings are never mis-classified)", () => {
    expect(matchStorefrontPolicy("GET", "/store/products/search")).toBeNull()
    expect(matchStorefrontPolicy("GET", "/store/products/petya-product")).toBeNull()
    expect(matchStorefrontPolicy("GET", `/store/payment-collections/pay_col_01M2EK8A2E0K44AX3V5XH27XRG`)).toBeNull()
    expect(
      matchStorefrontPolicy("POST", `/store/payment-collections/pay_col_01M2EK8A2E0K44AX3V5XH27XRG/payment-sessions`)
        ?.params
    ).toEqual({ id: "pay_col_01M2EK8A2E0K44AX3V5XH27XRG" })
  })
})
