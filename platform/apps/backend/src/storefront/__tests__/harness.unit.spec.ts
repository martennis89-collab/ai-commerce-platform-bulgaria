import { spawnSync } from "child_process"
import path from "path"
import { WORKSPACE_ROOT } from "@platform/storefront-core"

/** apps/storefront is a single-manifest harness, never a multi-tenant runtime (Level 3 §2). */
describe("storefront harness", () => {
  const harness = path.join(WORKSPACE_ROOT, "apps", "storefront", "scripts", "harness.mjs")
  const run = (args: string[]) =>
    spawnSync(process.execPath, [harness, ...args], { encoding: "utf8", timeout: 30000 })

  it.each([
    ["no manifest", []],
    ["a flag without a value", ["--manifest"]],
    ["two manifests", ["--manifest", "a.json", "--manifest", "b.json"]],
  ])("refuses to start with %s", (_label, args) => {
    const result = run(args as string[])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/exactly one manifest/)
  })
})
