import fs from "fs"
import os from "os"
import path from "path"
import {
  CORE_NODE_MODULES,
  ManifestError,
  MANIFEST_FILENAME,
  materializeBuild,
  STOREFRONT_CORE_VERSION,
  validateDeploymentManifest,
} from "@platform/storefront-core"
import { defaultStorefrontConfig, parseStorefrontConfig } from "@platform/storefront-schema"

const validManifest = () => ({
  manifest_version: 1,
  deployment_id: "dpl_01M2EK8A2E0K44AX3V5XH27XRG",
  project_id: "sfp_01M2EK8A2E4ZJB6X2VGVNXF9GH",
  store_handle: "maria-candles",
  target: "preview",
  hostname: "maria-candles.preview.shops.test",
  core_version: STOREFRONT_CORE_VERSION,
  backend_url: "http://localhost:9000",
  publishable_key: "pk_0123abcd",
  config: defaultStorefrontConfig("Maria Candles"),
})

describe("storefront-schema (strict, schema-first config)", () => {
  it("accepts the default config", () => {
    expect(parseStorefrontConfig(defaultStorefrontConfig("Maria Candles")).store.name).toBe("Maria Candles")
  })

  it.each([
    ["unknown top-level key", { store_environment_id: "senv_b" }],
    ["unknown nested key", { store: { ...defaultStorefrontConfig("x").store, publishable_key: "pk_b" } }],
    ["wrong locale", { store: { ...defaultStorefrontConfig("x").store, locale: "en-US" } }],
    ["wrong currency", { store: { ...defaultStorefrontConfig("x").store, currency_code: "bgn" } }],
    ["empty name", { store: { ...defaultStorefrontConfig("x").store, name: "  " } }],
    ["unknown theme", { theme: { preset: "custom" } }],
  ])("rejects %s", (_label, patch) => {
    expect(() => parseStorefrontConfig({ ...defaultStorefrontConfig("Maria Candles"), ...patch })).toThrow(
      /Invalid storefront config/
    )
  })
})

describe("storefront-core deployment manifest", () => {
  it("accepts a valid single-environment manifest", () => {
    expect(validateDeploymentManifest(validManifest()).store_handle).toBe("maria-candles")
  })

  it.each([
    ["an extra tenant selector", { store_environment_id: "senv_b" }],
    ["a second publishable key", { publishable_keys: ["pk_a", "pk_b"] }],
    ["a non-publishable key", { publishable_key: "sk_secret" }],
    ["a malformed hostname", { hostname: "maria candles" }],
    ["a malformed deployment id", { deployment_id: "../../etc" }],
    ["invalid config", { config: { ...defaultStorefrontConfig("x"), extra: true } }],
    ["an unavailable core version", { core_version: "9.9.9" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => validateDeploymentManifest({ ...validManifest(), ...patch })).toThrow(ManifestError)
  })

  it("materialises an isolated build with exactly one manifest and the core's dependencies", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "m1-build-")), "build")
    materializeBuild(dir, validManifest())
    expect(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILENAME), "utf8")).publishable_key).toBe("pk_0123abcd")
    expect(fs.existsSync(path.join(dir, "app", "page.jsx"))).toBe(true)
    expect(fs.realpathSync(path.join(dir, "node_modules"))).toBe(fs.realpathSync(CORE_NODE_MODULES))
    expect(() => materializeBuild(dir, validManifest())).toThrow(/new and empty/)
  })
})
