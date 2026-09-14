/**
 * Local, credential-free deployment adapter (ADR-017).
 *
 * Each deployment gets its own build directory under the deploy root, is built
 * from the pinned storefront-core with `next build` (static export), and is
 * served by the host-routed preview gateway. The build process inherits an
 * allow-listed environment only: no database URL, JWT/cookie secrets or any
 * other backend configuration can reach storefront code.
 */
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import {
  DeploymentManifest,
  materializeBuild,
  nextCliPath,
  WORKSPACE_ROOT,
} from "@platform/storefront-core"
import { localDeployRoot, previewGatewayPort } from "../platform-config"
import type { StorefrontDeployProvider } from "./provider"

/** OS/tooling variables a Node build needs on Windows, macOS and Linux. Nothing else is passed. */
export const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "LANG",
]

export function buildChildEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = parent[key]
    if (typeof value === "string") {
      env[key] = value
    }
  }
  env.NODE_ENV = "production"
  env.NEXT_TELEMETRY_DISABLED = "1"
  env.STOREFRONT_TURBOPACK_ROOT = WORKSPACE_ROOT
  return env
}

const BUILD_TIMEOUT_MS = 10 * 60 * 1000

function runBuild(buildDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(path.join(buildDir, "build.log"))
    const tail: string[] = []
    const child = spawn(process.execPath, [nextCliPath(), "build"], {
      cwd: buildDir,
      env: buildChildEnv(),
      windowsHide: true,
    })
    const capture = (chunk: Buffer) => {
      log.write(chunk)
      tail.push(chunk.toString())
      if (tail.length > 40) {
        tail.shift()
      }
    }
    child.stdout.on("data", capture)
    child.stderr.on("data", capture)
    const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS)
    child.on("error", (e) => {
      clearTimeout(timer)
      log.end()
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      log.end()
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`next build exited with ${code}: ${tail.join("").slice(-1500)}`))
      }
    })
  })
}

export const localProvider: StorefrontDeployProvider = {
  name: "local",
  async deploy(manifest: DeploymentManifest) {
    const root = localDeployRoot()
    const buildDir = path.join(root, "builds", manifest.deployment_id)
    materializeBuild(buildDir, manifest)
    await runBuild(buildDir)
    const outDir = path.join(buildDir, "out")
    if (!fs.existsSync(path.join(outDir, "index.html"))) {
      throw new Error("next build did not produce out/index.html")
    }
    return {
      artifact_ref: path.relative(root, outDir).split(path.sep).join("/"),
      url: `http://${manifest.hostname}:${previewGatewayPort()}/`,
    }
  },
}
