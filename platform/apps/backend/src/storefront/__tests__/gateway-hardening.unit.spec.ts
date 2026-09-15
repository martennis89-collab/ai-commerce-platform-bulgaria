import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { createPreviewGateway, expectedArtifactRef } from "../deploy/gateway"
import { previewGatewayPort } from "../platform-config"

const MARIA = `dpl_${"M".repeat(26)}`
const PETYA = `dpl_${"P".repeat(26)}`

describe("preview gateway hardening (independent M1 review, M3 N-c)", () => {
  let root: string
  let outside: string
  let server: http.Server
  let port: number

  const get = (urlPath: string) =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: urlPath, headers: { host: "maria-candles.preview.localhost" } },
        (res) => {
          let body = ""
          res.on("data", (c) => (body += c))
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
        }
      )
      req.on("error", reject)
      req.end()
    })

  let route = { deployment_id: MARIA, artifact_ref: `builds/${MARIA}/out` }

  beforeAll(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "m1-gw-hard-"))
    root = path.join(base, "deploy-root")
    outside = path.join(base, "outside")
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, "secret.txt"), "OUTSIDE-SECRET")
    for (const [id, title] of [
      [MARIA, "Maria Candles"],
      [PETYA, "Petya Jewellery"],
    ]) {
      const out = path.join(root, "builds", id, "out")
      fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(path.join(out, "index.html"), title)
    }
    // N2: a junction inside the artifact pointing outside the deploy root.
    fs.symlinkSync(outside, path.join(root, "builds", MARIA, "out", "leak"), "junction")
    // A deployment directory whose out/ is a junction to outside the root.
    const junctionId = `dpl_${"J".repeat(26)}`
    fs.mkdirSync(path.join(root, "builds", junctionId), { recursive: true })
    fs.symlinkSync(outside, path.join(root, "builds", junctionId, "out"), "junction")
    // A deployment directory whose out/ is a junction to ANOTHER deployment (aliasing).
    const aliasId = `dpl_${"A".repeat(26)}`
    fs.mkdirSync(path.join(root, "builds", aliasId), { recursive: true })
    fs.symlinkSync(path.join(root, "builds", PETYA, "out"), path.join(root, "builds", aliasId, "out"), "junction")
    ;(globalThis as any).__gwIds = { junctionId, aliasId }

    server = createPreviewGateway({
      deployRoot: root,
      resolveRoute: async () => ({ hostname: "maria-candles.preview.localhost", ...route }),
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
    port = (server.address() as any).port
  })

  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  afterEach(() => {
    route = { deployment_id: MARIA, artifact_ref: `builds/${MARIA}/out` }
  })

  it("serves the artifact but never follows a junction out of it", async () => {
    expect(await get("/")).toMatchObject({ status: 200, body: "Maria Candles" })
    const leak = await get("/leak/secret.txt")
    expect(leak.status).toBe(404)
    expect(leak.body).not.toContain("OUTSIDE-SECRET")
  })

  it("forbids framing and sniffing on every response, including errors", async () => {
    for (const res of [await get("/"), await get("/missing")]) {
      expect(res.headers["content-security-policy"]).toBe("frame-ancestors 'none'")
      expect(res.headers["x-frame-options"]).toBe("DENY")
      expect(res.headers["x-content-type-options"]).toBe("nosniff")
    }
  })

  it.each([
    ["an artifact_ref that is not builds/<deployment_id>/out", () => ({ deployment_id: MARIA, artifact_ref: `builds/${PETYA}/out` })],
    ["another deployment's directory", () => ({ deployment_id: MARIA, artifact_ref: "builds/../builds/" + PETYA + "/out" })],
    ["a relative escape", () => ({ deployment_id: MARIA, artifact_ref: "../" })],
    ["a malformed deployment id", () => ({ deployment_id: "../../x", artifact_ref: "builds/../../x/out" })],
    ["an out/ junction resolving outside the deploy root", () => ({ deployment_id: (globalThis as any).__gwIds.junctionId, artifact_ref: `builds/${(globalThis as any).__gwIds.junctionId}/out` })],
    ["an out/ junction aliasing another deployment", () => ({ deployment_id: (globalThis as any).__gwIds.aliasId, artifact_ref: `builds/${(globalThis as any).__gwIds.aliasId}/out` })],
  ])("refuses %s", async (_label, makeRoute) => {
    route = makeRoute()
    const res = await get("/secret.txt")
    expect(res.status).toBe(404)
    expect(res.body).not.toContain("OUTSIDE-SECRET")
    const home = await get("/")
    expect(home.status).toBe(404)
    expect(home.body).not.toContain("Petya")
  })

  it("derives the only acceptable artifact path from a well-formed deployment id", () => {
    expect(expectedArtifactRef(MARIA)).toBe(`builds/${MARIA}/out`)
    expect(expectedArtifactRef("dpl_../x")).toBeNull()
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
