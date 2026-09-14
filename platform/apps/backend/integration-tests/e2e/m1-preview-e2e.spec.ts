/**
 * M1 end-to-end: real storefront-core builds via the local deployment provider,
 * served through the host-routed preview gateway. Proves that each preview URL
 * renders only its own environment's storefront (M1-T02) and that build
 * artifacts carry only their own environment's publishable key.
 */
import fs from "fs"
import http from "http"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { WORKSPACE_ROOT } from "@platform/storefront-core"
import { createSharedRegion } from "../fixtures/commerce"
import { bearer, createUserWithToken } from "../fixtures/http"
import { STOREFRONT_MODULE } from "../../src/modules/storefront"
import { TENANCY_MODULE } from "../../src/modules/tenancy"
import { assignResourcesToEnvironment, registerPlatformOperator } from "../../src/tenancy/provisioning"
import { createPreviewGateway, resolvePreviewRoute } from "../../src/storefront/deploy/gateway"

jest.setTimeout(30 * 60 * 1000)

const DEPLOY_ROOT = path.join(WORKSPACE_ROOT, ".local-deployments-e2e")

medusaIntegrationTestRunner({
  env: {
    STOREFRONT_DEPLOY_PROVIDER: "local",
    PLATFORM_BASE_DOMAIN: "localhost",
    STOREFRONT_DEPLOY_ROOT: DEPLOY_ROOT,
  },
  testSuite: ({ api, getContainer }) => {
    type Store = { envId: string; projectId: string; handle: string; name: string; product: string; readyDeploymentId?: string }
    let operatorToken: string
    let gateway: http.Server
    let port: number
    const stores: Record<"maria" | "petya", Store> = {
      maria: { envId: "", projectId: "", handle: "maria-candles", name: "Maria Candles", product: "Maria Vanilla Candle" },
      petya: { envId: "", projectId: "", handle: "petya-jewellery", name: "Petya Jewellery", product: "Petya Silver Bracelet" },
    }

    const storefront = () => getContainer().resolve(STOREFRONT_MODULE) as any

    const waitForDeployment = async (id: string, timeoutMs = 15 * 60 * 1000) => {
      const started = Date.now()
      for (;;) {
        const [d] = await storefront().listDeployments({ id })
        if (d && (d.status === "ready" || d.status === "failed")) {
          return d
        }
        if (Date.now() - started > timeoutMs) {
          throw new Error(`deployment ${id} still ${d?.status}`)
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    const fetchHost = (host: string, urlPath = "/") =>
      new Promise<{ status: number; body: string; deployment?: string }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { host } }, (res) => {
          let body = ""
          res.setEncoding("utf8")
          res.on("data", (c) => (body += c))
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body, deployment: res.headers["x-platform-deployment"] as string })
          )
        })
        req.on("error", reject)
        req.end()
      })

    const filesUnder = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name)
        if (e.isSymbolicLink() || e.name === "node_modules" || e.name === ".next") {
          return []
        }
        return e.isDirectory() ? filesUnder(full) : [full]
      })

    const keyTokenOf = async (store: Store) => {
      const [project] = await storefront().listStorefrontProjects({ id: store.projectId })
      const { data } = await getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "api_key", fields: ["token"], filters: { id: project.publishable_api_key_id } })
      return (data[0] as any).token as string
    }

    beforeAll(async () => {
      fs.rmSync(DEPLOY_ROOT, { recursive: true, force: true })
      process.env.STOREFRONT_BACKEND_URL = String(api.defaults.baseURL).replace(/\/$/, "")
      const container = getContainer()
      const regionId = (await createSharedRegion(container)).id
      expect(regionId).toBeTruthy()
      const operator = await createUserWithToken(container, api, "operator@platform.test")
      await registerPlatformOperator(container, operator.user.id)
      operatorToken = operator.token

      // 1. Create both environments; each immediately gets a real preview build of its (empty) shell.
      const initial: string[] = []
      for (const store of Object.values(stores)) {
        const res = await api.post("/admin/platform/store-environments", { handle: store.handle, name: store.name }, bearer(operatorToken))
        store.envId = res.data.store_environment.id
        store.projectId = res.data.storefront_project.id
        initial.push(res.data.deployment.id)
      }
      const firstBuilds = await Promise.all(initial.map((id) => waitForDeployment(id)))
      for (const d of firstBuilds) {
        expect({ id: d.id, status: d.status, error: d.error }).toMatchObject({ status: "ready" })
      }

      // 2. Give each environment a product (owned by it) and redeploy its preview.
      const tenancy = container.resolve(TENANCY_MODULE) as any
      const redeploys: string[] = []
      for (const [key, store] of Object.entries(stores)) {
        const [channel] = await tenancy.listOwnedResourceIds(store.envId, "sales_channel")
        const {
          result: [product],
        } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: store.product,
                handle: `${key}-product`,
                status: "published",
                options: [{ title: "Size", values: ["Standard"] }],
                variants: [
                  {
                    title: `${store.product} Standard`,
                    options: { Size: "Standard" },
                    manage_inventory: false,
                    prices: [{ amount: key === "maria" ? 18 : 65, currency_code: "eur" }],
                  },
                ],
                sales_channels: [{ id: channel }],
              },
            ],
          },
        })
        await assignResourcesToEnvironment(container, store.envId, { product: [product.id] })
        const res = await api.post(`/admin/platform/store-environments/${store.envId}/preview-deployments`, {}, bearer(operatorToken))
        redeploys.push(res.data.deployment.id)
      }
      const builds = await Promise.all(redeploys.map((id) => waitForDeployment(id)))
      Object.values(stores).forEach((store, i) => {
        expect({ status: builds[i].status, error: builds[i].error }).toMatchObject({ status: "ready" })
        store.readyDeploymentId = builds[i].id
      })

      gateway = createPreviewGateway({
        deployRoot: DEPLOY_ROOT,
        resolveRoute: (host) => resolvePreviewRoute(getContainer(), host),
      })
      await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", () => r()))
      port = (gateway.address() as any).port
    })

    afterAll(async () => {
      if (gateway) {
        await new Promise<void>((r) => gateway.close(() => r()))
      }
    })

    it("M1-T02 each preview URL renders only its own environment's storefront shell and catalogue", async () => {
      for (const [key, store] of Object.entries(stores)) {
        const other = key === "maria" ? stores.petya : stores.maria
        const res = await fetchHost(`${store.handle}.preview.localhost:8787`)
        expect(res.status).toBe(200)
        expect(res.deployment).toBe(store.readyDeploymentId)
        expect(res.body).toContain(store.name)
        expect(res.body).toContain(store.product)
        expect(res.body).toContain('lang="bg"')
        expect(res.body).toContain(`content="${store.readyDeploymentId}"`)
        expect(res.body).not.toContain(other.name)
        expect(res.body).not.toContain(other.product)
      }
    })

    it("M1-T05e live, look-alike and unknown hosts are not served by the preview gateway", async () => {
      for (const host of [
        "maria-candles.localhost",
        "maria-candles.preview.localhost.evil.com",
        "evil-maria-candles.preview.localhost",
        "preview.localhost",
        "unknown.preview.localhost",
      ]) {
        const res = await fetchHost(host)
        expect({ host, status: res.status, leaked: res.body.includes("Maria") }).toEqual({ host, status: 404, leaked: false })
      }
    })

    it("M1-T04e build artifacts contain only their own publishable key and no backend secrets", async () => {
      const tokens = { maria: await keyTokenOf(stores.maria), petya: await keyTokenOf(stores.petya) }
      for (const [key, store] of Object.entries(stores)) {
        const otherToken = key === "maria" ? tokens.petya : tokens.maria
        const buildDir = path.join(DEPLOY_ROOT, "builds", store.readyDeploymentId as string)
        const files = filesUnder(buildDir).filter((f) => !f.endsWith("build.log"))
        expect(files.length).toBeGreaterThan(3)
        let ownKeySeen = false
        for (const file of files) {
          const content = fs.readFileSync(file, "utf8")
          expect({ file, foreign: content.includes(otherToken) }).toEqual({ file, foreign: false })
          expect({ file, secret: /postgres:\/\/|supersecret|JWT_SECRET|COOKIE_SECRET|DATABASE_URL/.test(content) }).toEqual({ file, secret: false })
          ownKeySeen ||= content.includes(tokens[key as "maria" | "petya"])
        }
        expect(ownKeySeen).toBe(true)
      }
    })

    it("M1-T05f suspending an environment immediately stops its preview being served", async () => {
      const tenancy = getContainer().resolve(TENANCY_MODULE) as any
      await tenancy.updateStoreEnvironments({ id: stores.maria.envId, status: "suspended" })
      expect((await fetchHost("maria-candles.preview.localhost")).status).toBe(404)
      expect((await fetchHost("petya-jewellery.preview.localhost")).status).toBe(200)
    })
  },
})
