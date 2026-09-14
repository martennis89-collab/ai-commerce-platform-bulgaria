import { z } from "@medusajs/framework/zod"
import { TenantScope } from "../context"
import { defineTenantTool, executeTenantTool, MERCHANT_TOOLS } from "../tools"

describe("typed tool boundary", () => {
  it("refuses to define a tool whose input can select a tenant", () => {
    expect(() =>
      defineTenantTool({
        name: "bad.tool",
        risk: 0,
        permission: "orders:read",
        input: z.object({ order_id: z.string(), store_environment_id: z.string() }),
        handler: async () => null,
      })
    ).toThrow(/tenant-selecting input/)
    expect(() =>
      defineTenantTool({
        name: "bad.nested",
        risk: 0,
        permission: "orders:read",
        input: z.object({ filter: z.object({ tenant_id: z.string().optional() }).optional() }),
        handler: async () => null,
      })
    ).toThrow(/tenant-selecting input/)
  })

  it("no registered merchant tool accepts tenant selection", () => {
    for (const tool of Object.values(MERCHANT_TOOLS)) {
      const parsed = (tool.input as any).safeParse({ store_environment_id: "senv_x" })
      expect(parsed.success).toBe(false)
    }
  })

  it("cannot mint a TenantScope outside the trusted resolvers", () => {
    expect(() => new TenantScope(Symbol("tenant-scope-mint"), "senv_b", {} as any)).toThrow(
      /trusted tenant resolver/
    )
  })

  it("rejects tool calls that smuggle tenant selectors or lack a server context", async () => {
    const handler = jest.fn(async () => "ran")
    const tool = defineTenantTool({
      name: "orders.echo",
      risk: 0,
      permission: "orders:read",
      input: z.object({ order_id: z.string() }),
      handler,
    })
    const fakeCtx: any = { scope: {}, permissions: ["orders:read"] }
    await expect(
      executeTenantTool(fakeCtx, tool, { order_id: "o", store_environment_id: "senv_b" })
    ).rejects.toThrow(/must not select a tenant/)
    await expect(
      executeTenantTool(fakeCtx, tool, { order_id: "o", meta: { tenantId: "senv_b" } })
    ).rejects.toThrow(/must not select a tenant/)
    await expect(executeTenantTool(fakeCtx, tool, { order_id: "o", extra: 1 })).rejects.toThrow(
      /Invalid arguments/
    )
    await expect(executeTenantTool({} as any, tool, { order_id: "o" })).rejects.toThrow(
      /ExecutionContext/
    )
    expect(handler).not.toHaveBeenCalled()
    await expect(executeTenantTool(fakeCtx, tool, { order_id: "o" })).resolves.toBe("ran")
  })
})
