/**
 * M2-T15 — opt-in live-provider smoke (B1). Runs only with
 * `ANTHROPIC_API_KEY` set (never committed): `npm run test:ai:live`.
 * A real model generates a Bulgarian sample store end to end through the same
 * audited tools; the deterministic suites never call a real provider.
 */
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { parseStorefrontConfig } from "@platform/storefront-schema"
import { bearer, createUserWithToken } from "../fixtures/http"
import { AI_MODULE } from "../../src/modules/ai"
import { STOREFRONT_MODULE } from "../../src/modules/storefront"
import { registerPlatformOperator } from "../../src/tenancy/provisioning"
import { sqlRows } from "../../src/ai/sql"
import { drainTasks, sweepExpired } from "../../src/ai/worker"

jest.setTimeout(20 * 60 * 1000)

if (!process.env.ANTHROPIC_API_KEY) {
  describe("M2-T15 live Anthropic smoke", () => {
    it.skip("requires ANTHROPIC_API_KEY (opt-in; required before M2 acceptance)", () => undefined)
  })
} else {
  medusaIntegrationTestRunner({
    env: {
      STOREFRONT_DEPLOY_PROVIDER: "dry-run",
      PLATFORM_BASE_DOMAIN: "shops.test",
      STOREFRONT_BACKEND_URL: "http://backend.internal:9000",
      AI_MODEL_PROVIDER: "anthropic",
      AI_WORKER_AUTOSTART: "false",
    },
    testSuite: ({ api, getContainer }) => {
      it("M2-T15 a real model generates a valid Bulgarian store through audited tools", async () => {
        const container = getContainer()
        const operator = await createUserWithToken(container, api, "operator@platform.test")
        await registerPlatformOperator(container, operator.user.id)
        const owner = await createUserWithToken(container, api, "owner@elena-honey.test")
        const created = await api.post(
          "/admin/platform/store-environments",
          { handle: "elena-honey", name: "Елена Мед", owner_user_id: owner.user.id },
          bearer(operator.token)
        )
        const projectId = created.data.storefront_project.id

        const description =
          "Семейно пчеларство от Троянския Балкан. Продаваме липов мед 900 г за 14 евро и акациев мед 900 г за 16 евро. " +
          "Имаме и восъчни свещи, но цената им още не е определена. Доставяме с куриер в цялата страна."
        const { data } = await api.post("/merchant/ai/runs", { description }, bearer(owner.token))
        const runId = data.run.id

        const startedAt = Date.now()
        let run: any
        for (;;) {
          await sweepExpired(container)
          await drainTasks(container, { budgetMs: 5 * 60 * 1000 })
          ;[run] = await (container.resolve(AI_MODULE) as any).listAgentRuns({ id: runId })
          if (["completed", "failed", "cancelled"].includes(run.status) || Date.now() - startedAt > 15 * 60 * 1000) break
          await new Promise((r) => setTimeout(r, 1000))
        }
        const tasks = await sqlRows(container, `SELECT task_key, status, error FROM ai_task WHERE run_id = ?`, [runId])
        expect({ status: run.status, tasks }).toMatchObject({ status: "completed" })

        const actions = await sqlRows(container, `SELECT tool, status, actor FROM ai_action WHERE run_id = ?`, [runId])
        expect(actions.every((a) => a.status === "succeeded" && a.actor.provider === "anthropic")).toBe(true)
        expect(actions.map((a) => a.actor.model)).toEqual(expect.arrayContaining([process.env.AI_GENERATION_MODEL || "claude-sonnet-5"]))

        const generations = await sqlRows(container, `SELECT kind, payload, resource_id FROM ai_generation WHERE run_id = ?`, [runId])
        const drafts = generations.filter((g) => g.kind === "product_draft")
        expect(drafts.length).toBeGreaterThanOrEqual(2)
        const { data: products } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
          entity: "product",
          fields: ["status", "title", "variants.prices.amount"],
          filters: { id: drafts.map((d) => d.resource_id) },
        })
        for (const p of products as any[]) {
          expect(p.status).toBe("draft")
          for (const price of p.variants[0].prices) {
            expect([14, 16]).toContain(price.amount)
          }
        }

        const [project] = await (container.resolve(STOREFRONT_MODULE) as any).listStorefrontProjects({ id: projectId })
        const config = parseStorefrontConfig(project.config)
        expect(config.schema_version).toBe(2)
        expect(config.home.about.body).toMatch(/[а-яА-Я]/)
        // eslint-disable-next-line no-console
        console.log("M2-T15 live output", JSON.stringify({ usage: run.usage, home: config.home, theme: config.theme, drafts: drafts.map((d) => d.payload) }, null, 2))
      })
    },
  })
}
