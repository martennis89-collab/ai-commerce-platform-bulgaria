/**
 * storefront-core harness: runs the template in `next dev` for exactly ONE
 * deployment manifest. It refuses zero or multiple manifests, so it can never
 * act as a shared multi-tenant storefront runtime (Level 3 §2).
 *
 *   npm run dev -w @platform/storefront-harness -- --manifest ./my-manifest.json
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const core = require("@platform/storefront-core")

const args = process.argv.slice(2)
const manifestFlags = args.flatMap((a, i) => (a === "--manifest" ? [args[i + 1]] : []))
if (manifestFlags.length !== 1 || !manifestFlags[0]) {
  console.error("Usage: harness --manifest <file>  (exactly one manifest; no multi-tenant mode)")
  process.exit(2)
}

const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFlags[0]), "utf8"))
const dir = path.resolve(import.meta.dirname, "..", ".harness", manifest.store_handle ?? "store")
fs.rmSync(dir, { recursive: true, force: true })
core.materializeBuild(dir, manifest)

const child = spawn(process.execPath, [core.nextCliPath(), "dev", "-p", process.env.PORT ?? "8000"], {
  cwd: dir,
  stdio: "inherit",
  env: { ...process.env, STOREFRONT_TURBOPACK_ROOT: core.WORKSPACE_ROOT, NEXT_TELEMETRY_DISABLED: "1" },
})
child.on("exit", (code) => process.exit(code ?? 0))
