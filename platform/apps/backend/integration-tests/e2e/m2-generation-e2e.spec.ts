/**
 * M2-T11 end-to-end: merchant-started generation (fake model) triggers a real
 * storefront-core 0.2.0 build through the durable deployment lane; each preview
 * renders its own generated brand, hero and about sections only, and AI product
 * drafts never appear on the storefront.
 */
import fs from "fs"
import http from "http"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { WORKSPACE_ROOT } from "@platform/storefront-core"
import { findSection, parseStorefrontConfig } from "@platform/storefront-schema"
import { createSharedRegion } from "../fixtures/commerce"
import { bearer, createUserWithToken } from "../fixtures/http"
import { AI_MODULE } from "../../src/modules/ai"
import { STOREFRONT_MODULE } from "../../src/modules/storefront"
import { registerPlatformOperator } from "../../src/tenancy/provisioning"
import { createPreviewGateway, resolvePreviewRoute } from "../../src/storefront/deploy/gateway"
import { drainTasks, sweepExpired } from "../../src/ai/worker"
import { drainDeployments } from "../../src/storefront/deployments"

jest.setTimeout(40 * 60 * 1000)

const DEPLOY_ROOT = path.join(WORKSPACE_ROOT, ".local-deployments-e2e-m2")

medusaIntegrationTestRunner({
  env: {
    STOREFRONT_DEPLOY_PROVIDER: "local",
    PLATFORM_BASE_DOMAIN: "localhost",
    STOREFRONT_DEPLOY_ROOT: DEPLOY_ROOT,
    AI_MODEL_PROVIDER: "fake",
    AI_WORKER_AUTOSTART: "false",
  },
  testSuite: ({ api, getContainer }) => {
    type Store = {
      handle: string
      name: string
      description: string
      product: string
      envId: string
      projectId: string
      token: string
      deploymentId?: string
    }
    const stores: Record<"maria" | "petya", Store> = {
      maria: {
        handle: "maria-candles",
        name: "Maria Candles",
        description: "Ръчно изработени соеви свещи от София. Всяка свещ се налива на малки партиди.",
        product: "Свещ Ванилия",
        envId: "",
        projectId: "",
        token: "",
      },
      petya: {
        handle: "petya-jewellery",
        name: "Petya Jewellery",
        description: "Сребърни бижута, изработени на ръка във Варна. Малки серии и внимание към детайла.",
        product: "Сребърна гривна Вълна",
        envId: "",
        projectId: "",
        token: "",
      },
    }
    let gateway: http.Server
    let port: number

    const storefront = () => getContainer().resolve(STOREFRONT_MODULE) as any
    const ai = () => getContainer().resolve(AI_MODULE) as any

    const fetchHost = (host: string) =>
      new Promise<{ status: number; body: string; deployment?: string }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/", headers: { host } }, (res) => {
          let body = ""
          res.setEncoding("utf8")
          res.on("data", (c) => (body += c))
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, deployment: res.headers["x-platform-deployment"] as string }))
        })
        req.on("error", reject)
        req.end()
      })

    const waitDeployment = async (id: string) => {
      const started = Date.now()
      for (;;) {
        await drainDeployments(getContainer(), { budgetMs: 1_000 })
        const [d] = await storefront().listDeployments({ id })
        if (d && ["ready", "failed"].includes(d.status)) return d
        if (Date.now() - started > 20 * 60 * 1000) throw new Error(`deployment ${id} still ${d?.status}`)
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    beforeAll(async () => {
      fs.rmSync(DEPLOY_ROOT, { recursive: true, force: true })
      process.env.STOREFRONT_BACKEND_URL = String(api.defaults.baseURL).replace(/\/$/, "")
      const container = getContainer()
      await createSharedRegion(container)
      const operator = await createUserWithToken(container, api, "operator@platform.test")
      await registerPlatformOperator(container, operator.user.id)

      for (const store of Object.values(stores)) {
        const owner = await createUserWithToken(container, api, `owner@${store.handle}.test`)
        const res = await api.post(
          "/admin/platform/store-environments",
          { handle: store.handle, name: store.name, owner_user_id: owner.user.id },
          bearer(operator.token)
        )
        store.envId = res.data.store_environment.id
        store.projectId = res.data.storefront_project.id
        store.token = owner.token
        expect((await waitDeployment(res.data.deployment.id)).status).toBe("ready")
      }

      for (const store of Object.values(stores)) {
        const { data } = await api.post(
          "/merchant/ai/runs",
          { description: store.description, facts: { products: [{ name: store.product, price_eur: 40 }] } },
          bearer(store.token)
        )
        const runId = data.run.id
        for (let i = 0; ; i++) {
          await sweepExpired(container)
          await drainTasks(container, { budgetMs: 60_000 })
          const [run] = await ai().listAgentRuns({ id: runId })
          if (run.status === "completed") break
          if (["failed", "cancelled"].includes(run.status) || i > 120) throw new Error(`run ${runId} ${run.status}`)
          await new Promise((r) => setTimeout(r, 500))
        }
        const [deployment] = await storefront().listDeployments({ request_key: `${runId}:storefront:preview` })
        const built = await waitDeployment(deployment.id)
        expect({ status: built.status, error: built.error }).toMatchObject({ status: "ready" })
        store.deploymentId = built.id
      }

      gateway = createPreviewGateway({ deployRoot: DEPLOY_ROOT, resolveRoute: (host) => resolvePreviewRoute(getContainer(), host) })
      await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", () => r()))
      port = (gateway.address() as any).port
    })

    afterAll(async () => {
      if (gateway) await new Promise<void>((r) => gateway.close(() => r()))
      fs.rmSync(DEPLOY_ROOT, { recursive: true, force: true })
    })

    it("M2-T11 each generated preview renders its own brand, hero and about sections; drafts stay hidden", async () => {
      for (const [key, store] of Object.entries(stores)) {
        const other = key === "maria" ? stores.petya : stores.maria
        const [project] = await storefront().listStorefrontProjects({ id: store.projectId })
        const config = parseStorefrontConfig(project.config)
        const res = await fetchHost(`${store.handle}.preview.localhost`)
        expect(res.status).toBe(200)
        expect(res.deployment).toBe(store.deploymentId)
        expect(res.body).toContain('lang="bg"')
        expect(res.body).toContain(`data-typography="${config.theme.typography}"`)
        expect(res.body.toLowerCase()).toContain(config.theme.colors.accent.toLowerCase())
        expect(res.body).toContain(findSection(config, "hero")!.headline)
        expect(res.body).toContain(findSection(config, "about")!.title)
        expect(res.body).toContain(store.description.split(".")[0])
        expect(res.body).toContain(findSection(config, "product_grid")!.empty_state)
        expect(res.body).not.toContain(store.product)
        expect(res.body).not.toContain(other.name)
        expect(res.body).not.toContain(other.description.split(".")[0])
      }
    })
  },
})
