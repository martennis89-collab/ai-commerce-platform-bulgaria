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
  response?: (body: any) => { type: "product" | "order" | "cart" | "shipping_option"; ids: string[] }[]
  /** Removes resources the scope does not own from a successful response (before `response` checks). */
  sanitize?: (body: any, scope: TenantScope) => Promise<any>
}

const asArray = (v: unknown): string[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? (v as string[]) : [v as string]

const noTenantData = async () => {}

/**
 * Medusa's Customer is one global row per email across all stores, so neither
 * its id nor its relation may reach a (merchant-controlled) storefront.
 */
const GLOBAL_CUSTOMER_KEYS = new Set(["customer", "customer_id"])

function requestedFields(query: any): string[] {
  const raw = query?.fields
  const values =
    raw && typeof raw === "object" && !Array.isArray(raw) ? Object.values(raw) : asArray(raw)
  return values.flatMap((value) =>
    String(value)
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean)
  )
}

/** Rejects any requested field path with a `customer` / `customer_id` segment at any depth. */
export function rejectsGlobalCustomerFields(query: any) {
  return requestedFields(query).some((field) =>
    field
      .replace(/^[+\-]/, "")
      .split(".")
      .some((segment) => GLOBAL_CUSTOMER_KEYS.has(segment.replace(/^\*/, "")))
  )
}

/** Removes `customer` / `customer_id` keys at any depth (e.g. `parent` carts, nested orders). */
export function stripGlobalCustomerFields(value: any, depth = 0): any {
  if (depth > 50 || value === null || typeof value !== "object") {
    return value
  }
  // Serialise exactly as res.json would (Medusa BigNumber totals, Dates) before walking.
  if (typeof value.toJSON === "function") {
    return stripGlobalCustomerFields(value.toJSON(), depth + 1)
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripGlobalCustomerFields(v, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (!GLOBAL_CUSTOMER_KEYS.has(key)) {
      out[key] = stripGlobalCustomerFields(v, depth + 1)
    }
  }
  return out
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
    rule: "cart_id query parameter is required and must be owned; only owned options are returned",
    check: async ({ scope, query }) => {
      if (typeof query?.cart_id !== "string") {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "cart_id is required")
      }
      await scope.assertOwned("cart", query.cart_id)
    },
    sanitize: async (body, scope) => {
      const options: any[] = body?.shipping_options ?? []
      const owners = await scope.tenancy().getOwners(
        "shipping_option",
        options.map((o) => o.id)
      )
      return {
        ...body,
        shipping_options: options.filter((o) => owners.get(o.id) === scope.storeEnvironmentId),
      }
    },
    response: (body) => [
      { type: "shipping_option", ids: ((body?.shipping_options ?? []) as any[]).map((o) => o.id) },
    ],
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

    // Medusa accepts `cart_id` on several read routes (e.g. product pricing context).
    // Wherever it appears, it must be a cart owned by this storefront.
    if (req.query?.cart_id !== undefined) {
      await scope.assertOwned("cart", asArray(req.query.cart_id as any))
    }

    await match.policy.check({
      scope,
      params: match.params,
      body: req.body ?? {},
      query: req.query ?? {},
    })

    req.tenantScope = scope

    installResponseGuard(res, scope, match.policy)
    return next()
  } catch (e) {
    return next(e)
  }
}

/**
 * Last line of defence, installed on every guarded storefront route:
 * 1. strips Medusa's global customer id/relation from the payload at any depth;
 * 2. where the policy declares tenant resources, every one of them must be owned
 *    by the request's environment. A violation means an upstream layer is
 *    broken, so the response is replaced by a 500.
 */
function installResponseGuard(
  res: MedusaResponse,
  scope: TenantScope,
  policy: StorefrontRoutePolicy
) {
  const originalJson = res.json.bind(res)
  ;(res as any).json = (rawBody: any) => {
    const body = stripGlobalCustomerFields(rawBody)
    if (res.statusCode >= 400 || (!policy.response && !policy.sanitize)) {
      return originalJson(body)
    }
    ;(async () => {
      const sanitized = policy.sanitize ? await policy.sanitize(body, scope) : body
      const checks = (policy.response?.(sanitized) ?? []).filter((c) => c.ids.length)
      await Promise.all(checks.map((c) => scope.assertOwned(c.type, c.ids)))
      return sanitized
    })()
      .then((sanitized) => originalJson(sanitized))
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
