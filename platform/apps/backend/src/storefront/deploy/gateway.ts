/**
 * Local preview gateway: a host-routed STATIC file server for ready preview
 * deployments. It contains no storefront code and renders nothing itself; each
 * hostname maps to exactly one per-deployment artifact directory, resolved from
 * the database on every request (so suspension, key revocation or a new
 * deployment takes effect immediately). Unknown, look-alike, live or suspended
 * hosts get 404.
 *
 * Run it locally with `npm run preview:gateway` (src/scripts/preview-gateway.ts).
 */
import fs from "fs"
import http from "http"
import path from "path"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STOREFRONT_MODULE } from "../../modules/storefront"
import type StorefrontModuleService from "../../modules/storefront/service"
import { TENANCY_MODULE } from "../../modules/tenancy"
import type TenancyModuleService from "../../modules/tenancy/service"
import { normalizeHostname } from "../../tenancy/hostname"
import { localDeployRoot, previewGatewayPort } from "../platform-config"

export type PreviewRoute = { hostname: string; deployment_id: string; artifact_ref: string }

/**
 * Exact preview hostname → newest ready preview deployment of an active project
 * in an active environment whose publishable key is still valid.
 */
export async function resolvePreviewRoute(
  container: MedusaContainer,
  rawHost: string | undefined
): Promise<PreviewRoute | null> {
  const host = normalizeHostname(rawHost)
  if (!host) {
    return null
  }
  const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
  const [project] = (await storefront.listStorefrontProjects({
    preview_hostname: host,
    status: "active",
  })) as any[]
  if (!project) {
    return null
  }
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  const [env] = await tenancy.listStoreEnvironments({
    id: project.store_environment_id,
    status: "active",
  })
  if (!env) {
    return null
  }
  const { data: keys } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "api_key",
    fields: ["id", "revoked_at"],
    filters: { id: project.publishable_api_key_id },
  })
  const key: any = keys[0]
  if (!key || (key.revoked_at && new Date(key.revoked_at) <= new Date())) {
    return null
  }
  const [deployment] = (await storefront.listDeployments(
    { project_id: project.id, target: "preview", status: "ready" },
    { order: { id: "DESC" }, take: 1 }
  )) as any[]
  if (
    !deployment?.artifact_ref ||
    deployment.hostname !== host ||
    deployment.store_environment_id !== project.store_environment_id
  ) {
    return null
  }
  return { hostname: host, deployment_id: deployment.id, artifact_ref: deployment.artifact_ref }
}

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

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

function send(res: http.ServerResponse, status: number, body = "") {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
  res.end(body || http.STATUS_CODES[status])
}

export function createPreviewGateway(options: {
  deployRoot: string
  resolveRoute: (host: string | undefined) => Promise<PreviewRoute | null>
}): http.Server {
  const deployRoot = path.resolve(options.deployRoot)
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405)
      }
      const route = await options.resolveRoute(req.headers.host)
      if (!route) {
        return send(res, 404)
      }
      // Containment is checked on real paths, so symlinks/junctions cannot escape.
      const realRoot = realpathOrNull(deployRoot)
      const realArtifact = realpathOrNull(path.resolve(deployRoot, route.artifact_ref))
      if (!realRoot || !realArtifact || !isInside(realRoot, realArtifact) || realArtifact === realRoot) {
        return send(res, 404)
      }
      let pathname: string
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://gateway.invalid").pathname)
      } catch {
        return send(res, 400)
      }
      if (pathname.includes("\0")) {
        return send(res, 400)
      }
      let file = path.resolve(realArtifact, `.${pathname}`)
      if (!isInside(realArtifact, file)) {
        return send(res, 404)
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.join(file, "index.html")
      }
      let status = 200
      let realFile = fs.existsSync(file) && fs.statSync(file).isFile() ? realpathOrNull(file) : null
      if (!realFile || !isInside(realArtifact, realFile)) {
        const notFound = realpathOrNull(path.join(realArtifact, "404.html"))
        if (!notFound || !isInside(realArtifact, notFound)) {
          return send(res, 404)
        }
        realFile = notFound
        status = 404
      }
      res.writeHead(status, {
        "content-type": CONTENT_TYPES[path.extname(realFile).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-platform-deployment": route.deployment_id,
      })
      if (req.method === "HEAD") {
        return res.end()
      }
      fs.createReadStream(realFile).pipe(res)
    } catch {
      if (!res.headersSent) {
        send(res, 500)
      } else {
        res.end()
      }
    }
  })
}

/** The runnable local gateway: DB-resolved routes over the local deploy root, loopback by default. */
export async function startPreviewGateway(
  container: MedusaContainer,
  options: { port?: number; host?: string; deployRoot?: string } = {}
): Promise<http.Server> {
  const server = createPreviewGateway({
    deployRoot: options.deployRoot ?? localDeployRoot(),
    resolveRoute: (host) => resolvePreviewRoute(container, host),
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(
      options.port ?? previewGatewayPort(),
      options.host ?? process.env.PREVIEW_GATEWAY_HOST ?? "127.0.0.1",
      () => resolve()
    )
  })
  return server
}
