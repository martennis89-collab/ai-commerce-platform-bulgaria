/**
 * Storefront (shopper-facing /store API) tenant policy.
 *
 * Deny-by-default: every /store route must be classified here with an explicit
 * ownership rule. Any route Medusa adds in a future upgrade — or that a
 * developer forgets to classify — is rejected with 403 until someone decides
 * how it is tenant-scoped. This is what keeps isolation central instead of
 * relying on every developer remembering ad-hoc checks.
 *
 * Tenant identity comes only from the server-side ownership record of the
 * publishable key (see `resolveStorefrontScope`). Sales-channel membership is
 * never consulted as authorization here.
 */
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveStorefrontScope, TenantScope } from "./context"
import { findTenantSelectorHeaders, findTenantSelectors } from "./selectors"

type Method = "GET" | "POST" | "DELETE"

type PolicyInput = {
  scope: TenantScope
  params: Record<string, string>
  body: any
  query: any
}

export type StorefrontRoutePolicy = {
  method: Method
  path: string
  /** Why this route is safe; required so every classification is a conscious decision. */
  rule: string
  check: (input: PolicyInput) => Promise<void>
  /** Resources in the JSON response that must be owned by the scope (response backstop). */
  response?: (body: any) => { type: "product" | "order" | "cart"; ids: string[] }[]
}

const asArray = (v: unknown): string[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? (v as string[]) : [v as string]

const noTenantData = async () => {}

function requestedFields(query: any): string[] {
  return asArray(query?.fields).flatMap((value) =>
    String(value)
      .split(",")
      .map((field) => field.trim().replace(/^[+-]/, ""))
      .filter(Boolean)
  )
}

function rejectsGlobalCustomerFields(query: any) {
  return requestedFields(query).some(
    (field) =>
      field === "customer_id" ||
      field === "customer" ||
      field === "*customer" ||
      field.startsWith("customer.") ||
      field.startsWith("*customer.")
  )
}

function withoutGlobalCustomerFields(body: any) {
  let next = body
  for (const root of ["cart", "order"] as const) {
    if (next?.[root] && typeof next[root] === "object") {
      const { customer: _customer, customer_id: _customerId, ...resource } = next[root]
      next = { ...next, [root]: resource }
    }
  }
  return next
}

const productResponse = (body: any) => [
  {
    type: "product" as const,
    ids: [
      ...(body?.product ? [body.product.id] : []),
      ...((body?.products ?? []) as any[]).map((p) => p.id),
    ],
  },
]

const cartResponse = (body: any) => [
  { type: "cart" as const, ids: body?.cart ? [body.cart.id] : [] },
]

async function checkCartBody(scope: TenantScope, body: any) {
  if (body?.sales_channel_id !== undefined) {
    await scope.assertOwned("sales_channel", body.sales_channel_id)
  }
  await scope.assertVariantsOwned(((body?.items ?? []) as any[]).map((i) => i?.variant_id))
  await scope.assertPromotionCodesOwned(asArray(body?.promo_codes))
}

export const STOREFRONT_ROUTE_POLICIES: StorefrontRoutePolicy[] = [
  // --- Platform-shared reference data (contains no tenant data) -------------
  {
    method: "GET",
    path: "/store/regions",
    rule: "Regions are platform-owned BG/EUR reference data (Medusa allows a country in only one region)",
    check: noTenantData,
  },
  {
    method: "GET",
    path: "/store/regions/:id",
    rule: "Regions are platform-owned reference data",
    check: noTenantData,
  },
  {
    method: "GET",
    path: "/store/payment-providers",
    rule: "Payment providers are platform-level; merchant payment accounts are resolved server-side later",
    check: noTenantData,
  },

  // --- Catalogue ---------------------------------------------------------------
  {
    method: "GET",
    path: "/store/products",
    rule: "List restricted to products owned by the environment (see tenantProductListFilter)",
    check: noTenantData,
    response: productResponse,
  },
  {
    method: "GET",
    path: "/store/products/:id",
    rule: "Product must be owned by the environment",
    check: ({ scope, params }) => scope.assertOwned("product", params.id),
    response: productResponse,
  },

  // --- Cart --------------------------------------------------------------------
  {
    method: "POST",
    path: "/store/carts",
    rule: "Sales channel, variants and promotion codes in the body must be owned",
    check: ({ scope, body }) => checkCartBody(scope, body),
    response: cartResponse,
  },
  {
    method: "GET",
    path: "/store/carts/:id",
    rule: "Cart must be owned",
    check: ({ scope, params }) => scope.assertOwned("cart", params.id),
    response: cartResponse,
  },
  {
    method: "POST",
    path: "/store/carts/:id",
    rule: "Cart must be owned; body sales channel / promotion codes must be owned",
    check: async ({ scope, params, body }) => {
      await scope.assertOwned("cart", params.id)
      await checkCartBody(scope, body)
    },
    response: cartResponse,
  },
  {
    method: "POST",
    path: "/store/carts/:id/line-items",
    rule: "Cart and variant must be owned",
    check: async ({ scope, params, body }) => {
      await scope.assertOwned("cart", params.id)
      await scope.assertVariantsOwned([body?.variant_id])
    },
    response: cartResponse,
  },
  {
    method: "POST",
    path: "/store/carts/:id/line-items/:line_id",
    rule: "Line item must belong to an owned cart",
    check: ({ scope, params }) => scope.assertLineItemInOwnedCart(params.id, params.line_id),
    response: cartResponse,
  },
  {
    method: "DELETE",
    path: "/store/carts/:id/line-items/:line_id",
    rule: "Line item must belong to an owned cart",
    check: ({ scope, params }) => scope.assertLineItemInOwnedCart(params.id, params.line_id),
  },
  {
    method: "POST",
    path: "/store/carts/:id/promotions",
    rule: "Cart and promotion codes must be owned",
    check: async ({ scope, params, body }) => {
      await scope.assertOwned("cart", params.id)
      await scope.assertPromotionCodesOwned(asArray(body?.promo_codes))
    },
    response: cartResponse,
  },
  {
    method: "DELETE",
    path: "/store/carts/:id/promotions",
    rule: "Cart must be owned",
    check: ({ scope, params }) => scope.assertOwned("cart", params.id),
    response: cartResponse,
  },
  {
    method: "GET",
    path: "/store/shipping-options",
    rule: "cart_id query parameter is required and must be owned",
    check: async ({ scope, query }) => {
      if (typeof query?.cart_id !== "string") {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "cart_id is required")
      }
      await scope.assertOwned("cart", query.cart_id)
    },
  },
  {
    method: "POST",
    path: "/store/carts/:id/shipping-methods",
    rule: "Cart and shipping option must be owned",
    check: async ({ scope, params, body }) => {
      await scope.assertOwned("cart", params.id)
      await scope.assertOwned("shipping_option", body?.option_id ?? "")
    },
    response: cartResponse,
  },
  {
    method: "POST",
    path: "/store/payment-collections",
    rule: "cart_id in body must be owned",
    check: ({ scope, body }) => scope.assertOwned("cart", body?.cart_id ?? ""),
  },
  {
    method: "POST",
    path: "/store/payment-collections/:id/payment-sessions",
    rule: "Payment collection must belong to an owned cart",
    check: async ({ scope, params }) => {
      await scope.assertPaymentCollectionOwned(params.id)
    },
  },
  {
    method: "POST",
    path: "/store/carts/:id/complete",
    rule: "Cart must be owned (contents re-validated by completeCartWorkflow hook)",
    check: ({ scope, params }) => scope.assertOwned("cart", params.id),
  },

  // --- Orders ------------------------------------------------------------------
  {
    method: "GET",
    path: "/store/orders/:id",
    rule: "Order must be owned (order id is Medusa's bearer secret for guest order lookup)",
    check: ({ scope, params }) => scope.assertOwned("order", params.id),
    response: (body) => [{ type: "order", ids: body?.order ? [body.order.id] : [] }],
  },
]

type CompiledPolicy = StorefrontRoutePolicy & { regex: RegExp; keys: string[] }

function compile(policy: StorefrontRoutePolicy): CompiledPolicy {
  const keys: string[] = []
  const pattern = policy.path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1))
        return "([^/]+)"
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
    .join("/")
  // Express routing is case-insensitive and tolerates one trailing slash; mirror it.
  return { ...policy, keys, regex: new RegExp(`^${pattern}/?$`, "i") }
}

const COMPILED = STOREFRONT_ROUTE_POLICIES.map(compile)

/**
 * Path params of classified routes are always Medusa entity ids (`prod_01…`).
 * Requiring that shape stops a static sibling route (e.g. GET /store/products/search)
 * from being mis-classified as the `:id` route it happens to resemble.
 */
const MEDUSA_ID = /^[a-z]+(?:_[a-z]+)*_[0-9A-Z]{26}$/

export function matchStorefrontPolicy(method: string, rawPath: string) {
  const effectiveMethod = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase()
  for (const policy of COMPILED) {
    if (policy.method !== effectiveMethod) {
      continue
    }
    const m = policy.regex.exec(rawPath)
    if (m) {
      const params: Record<string, string> = {}
      try {
        policy.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
      } catch {
        return null
      }
      if (Object.values(params).some((v) => !MEDUSA_ID.test(v))) {
        continue
      }
      return { policy, params }
    }
  }
  return null
}

export type TenantAwareRequest = MedusaRequest & { tenantScope?: TenantScope }

/** Global middleware for every /store request. Runs before all route middlewares. */
export async function storefrontTenantGuard(
  req: TenantAwareRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    if (req.method.toUpperCase() === "OPTIONS") {
      return next()
    }
    const selectorHeaders = findTenantSelectorHeaders(req.headers as any)
    const selectors = [
      ...findTenantSelectors(req.body, "body"),
      ...findTenantSelectors(req.query, "query"),
    ]
    if (selectorHeaders.length || selectors.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Tenant context is established by the server and cannot be supplied by the client"
      )
    }

    const scope = await resolveStorefrontScope(
      req.scope,
      (req as any).publishable_key_context?.key
    )

    const path = (req.originalUrl ?? req.url).split("?")[0]
    const match = matchStorefrontPolicy(req.method, path)
    if (!match) {
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "This storefront API route is not enabled for tenant storefronts"
      )
    }
    if (rejectsGlobalCustomerFields(req.query)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Medusa customer fields are platform-internal; storefronts use tenant-scoped guest checkout"
      )
    }

    await match.policy.check({
      scope,
      params: match.params,
      body: req.body ?? {},
      query: req.query ?? {},
    })

    req.tenantScope = scope

    if (match.policy.response) {
      installResponseBackstop(res, scope, match.policy.response)
    }
    return next()
  } catch (e) {
    return next(e)
  }
}

/**
 * Last line of defence: before any JSON leaves a guarded route, every tenant
 * resource in it must be owned by the request's environment. A violation here
 * means an upstream layer is broken, so the response is replaced by a 500.
 */
function installResponseBackstop(
  res: MedusaResponse,
  scope: TenantScope,
  extract: NonNullable<StorefrontRoutePolicy["response"]>
) {
  const originalJson = res.json.bind(res)
  ;(res as any).json = (body: any) => {
    if (res.statusCode >= 400) {
      return originalJson(body)
    }
    body = withoutGlobalCustomerFields(body)
    const checks = extract(body).filter((c) => c.ids.length)
    Promise.all(checks.map((c) => scope.assertOwned(c.type, c.ids)))
      .then(() => originalJson(body))
      .catch(() => {
        res.status(500)
        originalJson({
          type: "tenant_isolation_backstop",
          message: "Response blocked by tenant isolation backstop",
        })
      })
    return res
  }
}

/**
 * Route middleware for GET /store/products. Registered in the project
 * middlewares so it runs after Medusa's own query validation has built
 * `req.filterableFields`; it narrows the query to owned products, intersecting
 * with (never widening) any filter Medusa or the client already applied.
 */
export async function tenantProductListFilter(
  req: TenantAwareRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const scope = req.tenantScope
    if (!scope || !req.filterableFields) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Tenant product filter misconfigured")
    }
    const owned = new Set(await scope.ownedIds("product"))
    const existing = req.filterableFields.id as any
    let ids: string[]
    if (existing === undefined) {
      ids = [...owned]
    } else {
      const requested = Array.isArray(existing)
        ? existing
        : typeof existing === "string"
          ? [existing]
          : Array.isArray(existing?.$in)
            ? existing.$in
            : null
      if (!requested) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported product id filter")
      }
      ids = requested.filter((id: string) => owned.has(id))
    }
    // An empty id list must never be interpreted as "no filter".
    req.filterableFields.id = ids.length ? ids : ["__tenant_owns_no_matching_products__"]
    return next()
  } catch (e) {
    return next(e)
  }
}
