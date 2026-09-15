/**
 * Storefront core — the shared, versioned renderer every independent
 * StorefrontProject is built from (Level 3 §2, §4; ADR-006).
 *
 * This module is the node-side contract used by deployment providers:
 * - the core version a project pins;
 * - the deployment manifest a build receives (server-built, strictly validated);
 * - materialising an isolated build directory from the template.
 *
 * A build directory contains exactly one manifest, therefore exactly one store
 * environment's publishable key. There is no multi-tenant runtime: each build is
 * a separate static artifact.
 */
import fs from "fs"
import path from "path"
import {
  formatIssues,
  MEDIA_ID_RE,
  mediaIdsOf,
  parseStorefrontConfig,
  StorefrontConfig,
  StorefrontConfigError,
  z,
} from "@platform/storefront-schema"

export * from "./bridge"

const PACKAGE_DIR = path.resolve(__dirname, "..")
const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"))

export const STOREFRONT_CORE_VERSION: string = pkg.version
export const TEMPLATE_DIR = path.join(PACKAGE_DIR, "template")
/** Dependencies (next, react, js-sdk) of the core; builds resolve them through a junction. */
export const CORE_NODE_MODULES = path.join(PACKAGE_DIR, "node_modules")
/** `platform/` — the common root of core dependencies and local build directories. */
export const WORKSPACE_ROOT = path.resolve(PACKAGE_DIR, "..", "..")
export const MANIFEST_FILENAME = "platform-deployment.json"
/** v2 (M3) adds the deployed revision and the server-resolved map of owned media the config references. */
export const MANIFEST_VERSION = 2 as const

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

export const DeploymentManifestSchema = z.strictObject({
  manifest_version: z.literal(MANIFEST_VERSION),
  deployment_id: z.string().regex(/^dpl_[0-9A-Z]{26}$/),
  project_id: z.string().regex(/^sfp_[0-9A-Z]{26}$/),
  store_handle: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/),
  target: z.enum(["preview", "live"]),
  hostname: z.string().regex(HOSTNAME),
  core_version: z.string().min(1),
  backend_url: z.string().regex(/^https?:\/\/[^\s/]+(\/.*)?$/),
  publishable_key: z.string().regex(/^pk_[A-Za-z0-9]+$/),
  revision_id: z.string().regex(/^srev_[0-9A-Z]{26}$/).nullable(),
  /** Owned media referenced by the config, resolved to URLs by the server (never supplied by config). */
  media: z.record(
    z.string().regex(MEDIA_ID_RE),
    z.strictObject({ url: z.string().regex(/^https?:\/\/[^\s"'<>]+$/) })
  ),
  config: z.unknown(),
})

export type DeploymentManifest = Omit<z.infer<typeof DeploymentManifestSchema>, "config"> & {
  config: StorefrontConfig
}

export class ManifestError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid deployment manifest: ${issues.join("; ")}`)
    this.name = "ManifestError"
    this.issues = issues
  }
}

export function validateDeploymentManifest(
  input: unknown,
  options: { availableCoreVersion?: string } = {}
): DeploymentManifest {
  const result = DeploymentManifestSchema.safeParse(input)
  if (!result.success) {
    throw new ManifestError(formatIssues(result.error))
  }
  let config: StorefrontConfig
  try {
    config = parseStorefrontConfig(result.data.config)
  } catch (e) {
    throw new ManifestError(e instanceof StorefrontConfigError ? e.issues.map((i) => `config.${i}`) : ["config: invalid"])
  }
  const referenced = new Set(mediaIdsOf(config))
  const unreferenced = Object.keys(result.data.media).filter((id) => !referenced.has(id))
  if (unreferenced.length) {
    throw new ManifestError([`media: entries not referenced by the config: ${unreferenced.join(", ")}`])
  }
  const available = options.availableCoreVersion ?? STOREFRONT_CORE_VERSION
  if (result.data.core_version !== available) {
    throw new ManifestError([
      `core_version ${result.data.core_version} is not available (this core is ${available})`,
    ])
  }
  return { ...result.data, config }
}

/**
 * Creates an isolated build directory: template files, the single validated
 * manifest, and a `node_modules` junction to the core's own dependencies.
 */
export function materializeBuild(buildDir: string, manifestInput: unknown): DeploymentManifest {
  const manifest = validateDeploymentManifest(manifestInput)
  if (fs.existsSync(buildDir) && fs.readdirSync(buildDir).length) {
    throw new ManifestError(["build directory must be new and empty"])
  }
  if (!fs.existsSync(path.join(CORE_NODE_MODULES, "next", "package.json"))) {
    throw new ManifestError([`storefront-core dependencies are not installed at ${CORE_NODE_MODULES}`])
  }
  fs.mkdirSync(buildDir, { recursive: true })
  fs.cpSync(TEMPLATE_DIR, buildDir, { recursive: true })
  fs.writeFileSync(path.join(buildDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2))
  fs.symlinkSync(CORE_NODE_MODULES, path.join(buildDir, "node_modules"), "junction")
  return manifest
}

/** Absolute path of the Next.js CLI entry used to build a materialised directory. */
export function nextCliPath(): string {
  return path.join(CORE_NODE_MODULES, "next", "dist", "bin", "next")
}
