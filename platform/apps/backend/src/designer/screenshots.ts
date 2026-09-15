/**
 * Preview screenshots (M3-D7). Headless Chromium renders one ready preview
 * deployment's OWN static artifact:
 *
 * - the page origin is the deployment's preview hostname, but no request for it
 *   ever reaches the network: every request is intercepted and answered from
 *   `builds/<deployment_id>/out` on disk, with real-path containment;
 * - the only other requests allowed are GETs for this store's own uploaded
 *   media on the backend (`/static/<store_environment_id>/…`);
 * - everything else (other hosts, internal addresses, file://, data exfiltration)
 *   is aborted.
 *
 * Captures are bounded: a small per-process browser cap, one capture per store
 * across processes (transaction advisory lock), and a deadline that closes the
 * browser. Busy requests are refused with 429 instead of queueing; the slot and
 * the lock are released on success, failure and timeout.
 *
 * The PNG is stored as a tenant-owned media file and recorded against the
 * deployment and its revision.
 */
import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { STOREFRONT_MODULE } from "../modules/storefront"
import type StorefrontModuleService from "../modules/storefront/service"
import { expectedArtifactRef, isInside } from "../storefront/deploy/gateway"
import { localDeployRoot, storefrontBackendUrl } from "../storefront/platform-config"
import { assertWithinRateLimit, RateLimitError } from "../storefront/rate-limits"
import { ExecutionContext, requirePermission } from "../tenancy/context"

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1440, height: 900 },
} as const

export const ScreenshotBody = z.strictObject({
  deployment_id: z.string().regex(/^dpl_[0-9A-Z]{26}$/),
  viewport: z.enum(["mobile", "desktop"]),
})

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
}

const BUSY_RETRY_SECONDS = 15

function boundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/** Browsers one backend process may run at once (1 or 2). */
export const screenshotConcurrency = () => boundedIntEnv("STOREFRONT_SCREENSHOT_CONCURRENCY", 1, 1, 2)

/** Deadline for one capture, after which the browser is closed. */
export const screenshotTimeoutMs = () => boundedIntEnv("STOREFRONT_SCREENSHOT_TIMEOUT_MS", 60_000, 1, 120_000)

let activeCaptures = 0

/** Captures currently running in this process (for tests and diagnostics). */
export const activeScreenshotCaptures = () => activeCaptures

/** Maps a request URL path to a file inside the artifact, or null. Real-path contained. */
export function artifactFileFor(realArtifact: string, urlPath: string): string | null {
  let pathname: string
  try {
    pathname = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (pathname.includes("\0")) {
    return null
  }
  let file = path.resolve(realArtifact, `.${pathname}`)
  if (!isInside(realArtifact, file)) {
    return null
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html")
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return null
  }
  const real = fs.realpathSync(file)
  return isInside(realArtifact, real) ? real : null
}

export type RequestDecision = { kind: "artifact"; file: string | null } | { kind: "media" } | { kind: "abort" }

/** The complete network policy of a screenshot browser. */
export function decideScreenshotRequest(input: {
  url: string
  method: string
  previewOrigin: string
  backendOrigin: string
  storeEnvironmentId: string
  realArtifact: string
}): RequestDecision {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return { kind: "abort" }
  }
  if (url.origin === input.previewOrigin) {
    return input.method === "GET" || input.method === "HEAD"
      ? { kind: "artifact", file: artifactFileFor(input.realArtifact, url.pathname) }
      : { kind: "abort" }
  }
  if (
    url.origin === input.backendOrigin &&
    input.method === "GET" &&
    url.pathname.startsWith(`/static/${input.storeEnvironmentId}/`) &&
    !url.pathname.includes("..")
  ) {
    return { kind: "media" }
  }
  return { kind: "abort" }
}

/** Renders the artifact in a network-isolated browser. The browser is always closed, at the latest at the deadline. */
async function renderPreviewPng(input: {
  hostname: string
  storeEnvironmentId: string
  realArtifact: string
  size: { width: number; height: number }
}): Promise<Buffer> {
  const previewOrigin = `https://${input.hostname}`
  const backendOrigin = new URL(storefrontBackendUrl()).origin
  const timeoutMs = screenshotTimeoutMs()
  // Loaded lazily: Playwright is only needed when a screenshot is requested.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require("playwright")
  const browser = await chromium.launch({ timeout: timeoutMs })
  const deadline = setTimeout(() => {
    browser.close().catch(() => undefined)
  }, timeoutMs)
  try {
    const context = await browser.newContext({
      viewport: input.size,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      locale: "bg-BG",
    })
    context.setDefaultTimeout(timeoutMs)
    await context.route("**/*", async (route: any) => {
      const request = route.request()
      const decision = decideScreenshotRequest({
        url: request.url(),
        method: request.method(),
        previewOrigin,
        backendOrigin,
        storeEnvironmentId: input.storeEnvironmentId,
        realArtifact: input.realArtifact,
      })
      if (decision.kind === "artifact") {
        if (!decision.file) {
          return route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" })
        }
        return route.fulfill({
          status: 200,
          contentType: CONTENT_TYPES[path.extname(decision.file).toLowerCase()] ?? "application/octet-stream",
          body: fs.readFileSync(decision.file),
        })
      }
      if (decision.kind === "media") {
        return route.continue()
      }
      return route.abort("blockedbyclient")
    })
    const page = await context.newPage()
    await page.goto(`${previewOrigin}/`, { waitUntil: "load", timeout: timeoutMs })
    return await page.screenshot({ type: "png", fullPage: false, timeout: timeoutMs })
  } finally {
    clearTimeout(deadline)
    await browser.close().catch(() => undefined)
  }
}

export async function captureScreenshot(ctx: ExecutionContext, body: unknown) {
  requirePermission(ctx, "storefront:design")
  const parsed = ScreenshotBody.safeParse(body ?? {})
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid_request")
  }
  const { deployment_id, viewport } = parsed.data
  const container = ctx.scope.container
  const env = ctx.scope.storeEnvironmentId
  const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
  const [deployment] = (await storefront.listDeployments({ id: deployment_id, store_environment_id: env } as any)) as any[]
  if (!deployment || deployment.target !== "preview") {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "deployment not found")
  }
  if (deployment.status !== "ready" || deployment.provider !== "local" || deployment.artifact_ref !== expectedArtifactRef(deployment.id)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "preview_not_built")
  }
  const realRoot = fs.realpathSync(localDeployRoot())
  const realArtifact = fs.realpathSync(path.join(realRoot, "builds", deployment.id, "out"))
  if (realArtifact !== path.join(realRoot, "builds", deployment.id, "out")) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "preview artifact location is not trusted")
  }
  await assertWithinRateLimit(container, env, "screenshot")

  // Process-wide browser cap: refuse instead of queueing requests behind running captures.
  if (activeCaptures >= screenshotConcurrency()) {
    throw new RateLimitError("screenshot", BUSY_RETRY_SECONDS, "busy")
  }
  activeCaptures++
  try {
    const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    // One capture per store across all backend processes. The transaction-level lock is released when the
    // transaction ends, whatever happens inside it (success, failure, timeout, lost connection).
    return await knex.transaction(async (trx: any) => {
      const [{ locked }] = ((await trx.raw(`SELECT pg_try_advisory_xact_lock(hashtext(?)) AS locked`, [`storefront_screenshot:${env}`]))
        ?.rows ?? [{ locked: false }]) as { locked: boolean }[]
      if (!locked) {
        throw new RateLimitError("screenshot", BUSY_RETRY_SECONDS, "busy")
      }
      const size = VIEWPORTS[viewport]
      let png: Buffer
      try {
        png = await renderPreviewPng({ hostname: deployment.hostname, storeEnvironmentId: env, realArtifact, size })
      } catch {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "screenshot_failed")
      }

      const fileModule: any = container.resolve(Modules.FILE)
      const file = await fileModule.createFiles({
        filename: `${env}/screenshots/${randomUUID()}.png`,
        mimeType: "image/png",
        content: png.toString("base64"),
        access: "public",
      })
      await ctx.scope.claim("media_file", [file.id])
      const screenshot: any = await storefront.createStorefrontScreenshots({
        store_environment_id: env,
        project_id: deployment.project_id,
        deployment_id: deployment.id,
        revision_id: deployment.revision_id ?? null,
        viewport,
        width: size.width,
        height: size.height,
        file_id: file.id,
        url: file.url,
        size_bytes: png.length,
        requested_by: ctx.user.id,
      } as any)
      return {
        id: screenshot.id,
        viewport,
        width: size.width,
        height: size.height,
        url: screenshot.url,
        deployment_id: deployment.id,
        revision_id: screenshot.revision_id,
        created_at: screenshot.created_at,
      }
    })
  } finally {
    activeCaptures--
  }
}
