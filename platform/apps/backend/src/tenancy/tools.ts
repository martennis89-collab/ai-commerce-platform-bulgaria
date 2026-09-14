/**
 * Typed tool boundary for the future AI operator (Level 3 §1.2, §6).
 *
 * This is NOT the AI system. It is the contract a model-facing tool must pass
 * through: the model supplies only validated arguments; the server supplies the
 * ExecutionContext. Tenant identity is structurally impossible to pass:
 *
 *   1. `defineTenantTool` refuses (at definition time) any input schema that
 *      declares a tenant-selecting field;
 *   2. schemas are strict, so unknown keys are rejected;
 *   3. `executeTenantTool` deep-scans raw arguments for tenant selectors before
 *      parsing and rejects the call outright;
 *   4. handlers receive the server-built context, and every resource id they
 *      touch goes through the tenant-scoped commerce service.
 */
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import { ExecutionContext, Permission, requirePermission } from "./context"
import { merchantCommerce } from "./merchant-commerce"
import { merchantStorefront } from "./merchant-storefront"
import { findTenantSelectors, isForbiddenTenantKey } from "./selectors"

export type RiskLevel = 0 | 1 | 2 | 3

export type TenantTool<S extends z.ZodObject<any>> = Readonly<{
  name: string
  risk: RiskLevel
  permission: Permission
  input: S
  handler: (ctx: ExecutionContext, input: z.infer<S>) => Promise<unknown>
}>

function collectSchemaKeys(schema: any, path = "$", depth = 0): string[] {
  if (!schema || depth > 20) {
    return []
  }
  const keys: string[] = []
  const shape = schema.shape ?? schema._def?.shape ?? schema._zod?.def?.shape
  if (shape && typeof shape === "object") {
    for (const [key, child] of Object.entries(shape)) {
      keys.push(`${path}.${key}`)
      keys.push(...collectSchemaKeys(child, `${path}.${key}`, depth + 1))
    }
  }
  const inner =
    schema._zod?.def?.innerType ?? schema._zod?.def?.element ?? schema._def?.innerType ?? schema._def?.type
  if (inner && inner !== schema && typeof inner === "object") {
    keys.push(...collectSchemaKeys(inner, path, depth + 1))
  }
  return keys
}

export function defineTenantTool<S extends z.ZodObject<any>>(def: {
  name: string
  risk: RiskLevel
  permission: Permission
  input: S
  handler: (ctx: ExecutionContext, input: z.infer<S>) => Promise<unknown>
}): TenantTool<S> {
  const forbidden = collectSchemaKeys(def.input).filter((p) =>
    isForbiddenTenantKey(p.split(".").pop() as string)
  )
  if (forbidden.length) {
    throw new Error(
      `Tool "${def.name}" declares tenant-selecting input (${forbidden.join(", ")}); tenant context is server-injected`
    )
  }
  return Object.freeze({ ...def, input: def.input.strict() as unknown as S })
}

export async function executeTenantTool(
  ctx: ExecutionContext,
  tool: TenantTool<any>,
  rawArgs: unknown
): Promise<unknown> {
  if (!ctx?.scope) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Tool execution requires a server ExecutionContext")
  }
  if (findTenantSelectors(rawArgs).length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Tool "${tool.name}" arguments must not select a tenant`
    )
  }
  const parsed = tool.input.safeParse(rawArgs)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Invalid arguments for tool "${tool.name}"`)
  }
  requirePermission(ctx, tool.permission)
  return tool.handler(ctx, parsed.data)
}

const id = z.string().min(1).max(100)

/** Minimal M0 tool set: enough to prove the boundary, not an AI feature. */
export const MERCHANT_TOOLS = {
  "catalogue.get_product": defineTenantTool({
    name: "catalogue.get_product",
    risk: 0,
    permission: "catalogue:read",
    input: z.object({ product_id: id }),
    handler: (ctx, input) => merchantCommerce(ctx).getProduct(input.product_id),
  }),
  "catalogue.update_product": defineTenantTool({
    name: "catalogue.update_product",
    risk: 1,
    permission: "catalogue:write",
    input: z.object({
      product_id: id,
      title: z.string().min(1).max(200).optional(),
      status: z.enum(["draft", "published"]).optional(),
    }),
    handler: (ctx, { product_id, ...update }) => merchantCommerce(ctx).updateProduct(product_id, update),
  }),
  "orders.get_order": defineTenantTool({
    name: "orders.get_order",
    risk: 0,
    permission: "orders:read",
    input: z.object({ order_id: id }),
    handler: (ctx, input) => merchantCommerce(ctx).getOrder(input.order_id),
  }),
  "orders.cancel_order": defineTenantTool({
    name: "orders.cancel_order",
    risk: 3,
    permission: "orders:write",
    input: z.object({ order_id: id }),
    handler: (ctx, input) => merchantCommerce(ctx).cancelOrder(input.order_id),
  }),
  "inventory.set_stock": defineTenantTool({
    name: "inventory.set_stock",
    risk: 1,
    permission: "inventory:write",
    input: z.object({
      inventory_item_id: id,
      location_id: id,
      stocked_quantity: z.number().int().min(0),
    }),
    handler: (ctx, input) =>
      merchantCommerce(ctx).setStockedQuantity(
        input.inventory_item_id,
        input.location_id,
        input.stocked_quantity
      ),
  }),
  "storefront.request_preview_deployment": defineTenantTool({
    name: "storefront.request_preview_deployment",
    risk: 1,
    permission: "storefront:deploy",
    // No arguments: project, environment and publishable key are server-derived.
    input: z.object({}),
    handler: (ctx) => merchantStorefront(ctx).requestPreviewDeployment(),
  }),
  "shoppers.list": defineTenantTool({
    name: "shoppers.list",
    risk: 0,
    permission: "shoppers:read",
    input: z.object({}),
    handler: (ctx) => merchantCommerce(ctx).listShoppers(),
  }),
} as const
