/**
 * Platform-level storefront settings and naming rules (ADR-017, ADR-018).
 * All values are server configuration; none can be supplied by a request.
 */
import path from "path"
import { MedusaError } from "@medusajs/framework/utils"
import { WORKSPACE_ROOT } from "@platform/storefront-core"
import { normalizeHostname } from "../tenancy/hostname"

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

/** Handles that would collide with platform hostnames or routes. */
export const RESERVED_HANDLES = new Set([
  "preview",
  "www",
  "admin",
  "api",
  "app",
  "auth",
  "merchant",
  "store",
  "static",
  "assets",
  "cdn",
  "mail",
  "localhost",
  "platform",
  "support",
  "help",
  "status",
  "docs",
  "dashboard",
  "login",
])

export function assertValidHandle(handle: unknown): string {
  if (
    typeof handle !== "string" ||
    !HANDLE_RE.test(handle) ||
    handle.includes("--") ||
    RESERVED_HANDLES.has(handle)
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Store handle must be 3-40 lowercase letters, digits or single hyphens, and not reserved"
    )
  }
  return handle
}

export function platformBaseDomain(): string {
  const domain = normalizeHostname(process.env.PLATFORM_BASE_DOMAIN ?? "localhost")
  if (!domain) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "PLATFORM_BASE_DOMAIN is not a valid hostname")
  }
  return domain
}

/** Live `<handle>.<domain>` and preview `<handle>.preview.<domain>` (always distinct: handles contain no dots). */
export function hostnamesForHandle(handle: string): { live: string; preview: string } {
  const valid = assertValidHandle(handle)
  const base = platformBaseDomain()
  const live = normalizeHostname(`${valid}.${base}`)
  const preview = normalizeHostname(`${valid}.preview.${base}`)
  if (!live || !preview) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Store handle does not produce valid hostnames")
  }
  return { live, preview }
}

export type DeployProviderName = "dry-run" | "local"

export function deployProviderName(): DeployProviderName {
  const value = process.env.STOREFRONT_DEPLOY_PROVIDER ?? "local"
  if (value !== "dry-run" && value !== "local") {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Unknown STOREFRONT_DEPLOY_PROVIDER ${value}`)
  }
  return value
}

/** Root for local build directories and the preview routing table (inside the workspace). */
export function localDeployRoot(): string {
  return path.resolve(process.env.STOREFRONT_DEPLOY_ROOT ?? path.join(WORKSPACE_ROOT, ".local-deployments"))
}

/** Backend URL that builds use for build-time Store API reads. */
export function storefrontBackendUrl(): string {
  return process.env.STOREFRONT_BACKEND_URL ?? "http://localhost:9000"
}

export function previewGatewayPort(): number {
  const port = Number(process.env.PREVIEW_GATEWAY_PORT ?? 8787)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787
}
