import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { createPreviewGateway } from "../deploy/gateway"
import { previewGatewayPort } from "../platform-config"

describe("preview gateway hardening (independent M1 review)", () => {
  let root: string
  let outside: string
  let server: http.Server
  let port: number

  const get = (urlPath: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: urlPath, headers: { host: "maria-candles.preview.localhost" } },
        (res) => {
          let body = ""
          res.on("data", (c) => (body += c))
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
        }
      )
      req.on("error", reject)
      req.end()
    })

  beforeAll(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "m1-gw-hard-"))
    root = path.join(base, "deploy-root")
    outside = path.join(base, "outside")
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, "secret.txt"), "OUTSIDE-SECRET")
    const out = path.join(root, "builds", "maria", "out")
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, "index.html"), "Maria Candles")
    // N2: a junction inside the artifact pointing outside the deploy root.
    fs.symlinkSync(outside, path.join(out, "leak"), "junction")
    // An artifact_ref that is itself a junction to outside the root.
    fs.symlinkSync(outside, path.join(root, "builds", "junction-artifact"), "junction")

    let artifactRef = "builds/maria/out"
    server = createPreviewGateway({
      deployRoot: root,
      resolveRoute: async () => ({ hostname: "maria-candles.preview.localhost", deployment_id: "dpl_x", artifact_ref: artifactRef }),
    })
    ;(server as any).setArtifact = (ref: string) => (artifactRef = ref)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
    port = (server.address() as any).port
  })

  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it("serves the artifact but never follows a junction out of it", async () => {
    expect(await get("/")).toMatchObject({ status: 200, body: "Maria Candles" })
    const leak = await get("/leak/secret.txt")
    expect(leak.status).toBe(404)
    expect(leak.body).not.toContain("OUTSIDE-SECRET")
  })

  it("refuses an artifact directory that resolves outside the deploy root", async () => {
    ;(server as any).setArtifact("builds/junction-artifact")
    const res = await get("/secret.txt")
    expect(res.status).toBe(404)
    expect(res.body).not.toContain("OUTSIDE-SECRET")
    ;(server as any).setArtifact("builds/maria/out")
  })
})

describe("runnable preview gateway entry point (M1-R1)", () => {
  it("is exposed as a medusa exec script and an npm script", () => {
    const backend = path.resolve(__dirname, "..", "..", "..")
    const script = require(path.join(backend, "src", "scripts", "preview-gateway.ts"))
    expect(typeof script.default).toBe("function")
    const pkg = JSON.parse(fs.readFileSync(path.join(backend, "package.json"), "utf8"))
    expect(pkg.scripts["preview:gateway"]).toBe("medusa exec ./src/scripts/preview-gateway.ts")
  })

  it("listens on the same port the local provider puts in preview URLs", () => {
    const original = process.env.PREVIEW_GATEWAY_PORT
    process.env.PREVIEW_GATEWAY_PORT = "9123"
    expect(previewGatewayPort()).toBe(9123)
    process.env.PREVIEW_GATEWAY_PORT = original
  })
})
