import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { WORKSPACE_ROOT } from "@platform/storefront-core"
import { createPreviewGateway, PreviewRoute } from "../deploy/gateway"
import { buildChildEnv } from "../deploy/local"

const MARIA_ID = `dpl_${"M".repeat(26)}`
const PETYA_ID = `dpl_${"P".repeat(26)}`

describe("local build child environment", () => {
  it("passes only allow-listed OS variables and never backend secrets", () => {
    const env = buildChildEnv({
      PATH: "/usr/bin",
      TEMP: "/tmp",
      DATABASE_URL: "postgres://secret",
      JWT_SECRET: "jwt",
      COOKIE_SECRET: "cookie",
      REDIS_URL: "redis://secret",
      STOREFRONT_BACKEND_URL: "http://internal",
      DB_PASSWORD: "postgres",
      SOME_MERCHANT_KEY: "pk_other",
    })
    expect(env).toEqual({
      PATH: "/usr/bin",
      TEMP: "/tmp",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      STOREFRONT_TURBOPACK_ROOT: WORKSPACE_ROOT,
    })
  })
})

describe("preview gateway (host-routed static artifacts)", () => {
  let root: string
  let server: http.Server
  let port: number

  const get = (hostHeader: string, urlPath = "/", method = "GET") =>
    new Promise<{ status: number; body: string; deployment?: string }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: urlPath, method, headers: { host: hostHeader } },
        (res) => {
          let body = ""
          res.on("data", (c) => (body += c))
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body,
              deployment: res.headers["x-platform-deployment"] as string | undefined,
            })
          )
        }
      )
      req.on("error", reject)
      req.end()
    })

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "m1-gateway-"))
    for (const [name, title] of [
      [MARIA_ID, "Maria Candles"],
      [PETYA_ID, "Petya Jewellery"],
    ]) {
      const out = path.join(root, "builds", name, "out")
      fs.mkdirSync(path.join(out, "about"), { recursive: true })
      fs.writeFileSync(path.join(out, "index.html"), `<h1>${title}</h1>`)
      fs.writeFileSync(path.join(out, "about", "index.html"), `about ${title}`)
      fs.writeFileSync(path.join(out, "404.html"), `not found ${title}`)
    }
    fs.writeFileSync(path.join(root, "secret.txt"), "backend secret")
    const routes: Record<string, PreviewRoute> = {
      "maria-candles.preview.localhost": { hostname: "maria-candles.preview.localhost", deployment_id: MARIA_ID, artifact_ref: `builds/${MARIA_ID}/out` },
      "petya-jewellery.preview.localhost": { hostname: "petya-jewellery.preview.localhost", deployment_id: PETYA_ID, artifact_ref: `builds/${PETYA_ID}/out` },
      "escape.preview.localhost": { hostname: "escape.preview.localhost", deployment_id: `dpl_${"E".repeat(26)}`, artifact_ref: "../" },
    }
    server = createPreviewGateway({
      deployRoot: root,
      resolveRoute: async (host) => routes[String(host).toLowerCase().replace(/:\d+$/, "")] ?? null,
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
    port = (server.address() as any).port
  })

  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it("serves each hostname only its own deployment artifact", async () => {
    const maria = await get("maria-candles.preview.localhost:8787")
    expect(maria).toMatchObject({ status: 200, deployment: MARIA_ID })
    expect(maria.body).toContain("Maria Candles")
    expect(maria.body).not.toContain("Petya")
    const petya = await get("petya-jewellery.preview.localhost", "/about/")
    expect(petya).toMatchObject({ status: 200, deployment: PETYA_ID })
    expect(petya.body).toBe("about Petya Jewellery")
  })

  it.each([
    ["unknown host", "unknown.preview.localhost", "/"],
    ["missing host", "", "/"],
    ["route escaping the deploy root", "escape.preview.localhost", "/secret.txt"],
  ])("returns 404 for %s", async (_label, host, urlPath) => {
    const res = await get(host, urlPath)
    expect(res.status).toBe(404)
    expect(res.body).not.toContain("backend secret")
  })

  it.each(["/../petya/out/index.html", "/%2e%2e/%2e%2e/%2e%2e/secret.txt", "/..%2f..%2f..%2fsecret.txt", "/%5c..%5c..%5c..%5csecret.txt"])(
    "never escapes the artifact directory: %s",
    async (urlPath) => {
      const res = await get("maria-candles.preview.localhost", urlPath)
      expect(res.body).not.toContain("backend secret")
      expect(res.body).not.toContain("Petya")
      expect([200, 400, 404]).toContain(res.status)
      if (res.status === 200) {
        expect(res.deployment).toBe(MARIA_ID)
      }
    }
  )

  it("uses the artifact's 404 page for missing paths and rejects non-GET methods", async () => {
    expect(await get("maria-candles.preview.localhost", "/nope/")).toMatchObject({ status: 404, body: "not found Maria Candles" })
    expect((await get("maria-candles.preview.localhost", "/", "POST")).status).toBe(405)
  })
})
