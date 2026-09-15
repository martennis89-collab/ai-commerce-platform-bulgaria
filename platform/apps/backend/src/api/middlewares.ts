import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import {
  adminOperatorOnly,
  denyCustomerAccounts,
  merchantExecutionContextMiddleware,
} from "../tenancy/merchant-guard"
import { storefrontTenantGuard, tenantProductListFilter } from "../tenancy/storefront-policy"
import { merchantCors } from "./merchant-cors"

/**
 * Global (method-less) middlewares are sorted by Medusa ahead of every
 * route-specific middleware and route handler, so these guards run before any
 * core Store/Admin route logic.
 */
export default defineMiddlewares({
  routes: [
    { matcher: "/store*", middlewares: [storefrontTenantGuard] },
    { matcher: "/admin*", middlewares: [adminOperatorOnly] },
    { matcher: "/auth*", middlewares: [denyCustomerAccounts] },
    {
      matcher: "/merchant*",
      middlewares: [merchantCors, authenticate("user", ["bearer"]), merchantExecutionContextMiddleware],
    },
    // Merchant photo uploads are base64 JSON; allow the configured size plus encoding overhead.
    { matcher: "/merchant/media", methods: ["POST"], bodyParser: { sizeLimit: "8mb" }, middlewares: [] },
    // Runs after Medusa's own GET /store/products query middlewares.
    { matcher: "/store/products", methods: ["GET"], middlewares: [tenantProductListFilter] },
  ],
})
