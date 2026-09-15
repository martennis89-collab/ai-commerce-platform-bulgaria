/**
 * M3 independent review — regression tests for the confirmed findings
 * (red-team review of PR #4 at d70fea8). Each test asserts the corrected
 * behaviour; before the remediation REVIEW-A1, A2 and B failed.
 *
 * - REVIEW-A1..A4: every terminal or cancelled designer turn is settled, so the
 *   store's designer is never locked by `turn_in_progress`.
 * - REVIEW-B, B2: a restore always wins against an in-flight designer turn (D8).
 * - REVIEW-S1, S2: screenshot capture concurrency is bounded (429 busy) and the
 *   capture slot and lock are released after success and failure.
 */
import fs from "fs"
import os from "os"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { bearer, call, createUserWithToken } from "../fixtures/http"
import { registerPlatformOperator } from "../../src/tenancy/provisioning"
import { fakeRegistry, resetFakeModel, setFakeOverride } from "../../src/ai/model/fake"
import { sqlRows } from "../../src/ai/sql"
import { claimNextTask, executeClaimedTask, sweepExpired } from "../../src/ai/worker"
import { drainDeployments } from "../../src/storefront/deployments"
import { RevisionConflictError } from "../../src/storefront/revisions"
import { STOREFRONT_MODULE } from "../../src/modules/storefront"

jest.setTimeout(10 * 60 * 1000)

medusaIntegrationTestRunner({
  env: {
    STOREFRONT_DEPLOY_PROVIDER: "dry-run",
    PLATFORM_BASE_DOMAIN: "shops.test",
    STOREFRONT_BACKEND_URL: "http://backend.internal:9000",
    AI_MODEL_PROVIDER: "fake",
    AI_WORKER_AUTOSTART: "false",
    AI_WORKER_LEASE_MS: "3000",
  },
  testSuite: ({ api, getContainer }) => {
    type Store = { envId: string; token: string; sessionId: string }
    let maria: Store
    let petya: Store
    let envSnapshot: NodeJS.ProcessEnv = {}
    const shotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m3-review-shots-"))

    const sql = (q: string, b: unknown[] = []) => sqlRows(getContainer(), q, b)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const state = async (s: Store) => (await api.get("/merchant/designer", bearer(s.token))).data.designer
    const send = (s: Store, content: string) =>
      call(api.post(`/merchant/designer/sessions/${s.sessionId}/messages`, { content, element_id: null }, bearer(s.token)))
    const runOf = async (assistantMessageId: string) =>
      (await sql(`SELECT run_id FROM ai_designer_message WHERE id = ?`, [assistantMessageId]))[0].run_id as string
    const messageStatus = async (assistantMessageId: string) =>
      (await sql(`SELECT status FROM ai_designer_message WHERE id = ?`, [assistantMessageId]))[0].status
    const planCalls = () => fakeRegistry().calls.filter((c) => c.operation === "designer.plan").length

    const createStore = async (operatorToken: string, handle: string, name: string): Promise<Store> => {
      const container = getContainer()
      const { user, token } = await createUserWithToken(container, api, `owner@${handle}.test`)
      const res = await api.post("/admin/platform/store-environments", { handle, name, owner_user_id: user.id }, bearer(operatorToken))
      for (let i = 0; i < 300; i++) {
        await drainDeployments(container, { budgetMs: 2_000 })
        const [d] = await (container.resolve(STOREFRONT_MODULE) as any).listDeployments({ id: res.data.deployment.id })
        if (d && ["ready", "failed"].includes(d.status)) break
        await sleep(100)
      }
      const session = await api.post("/merchant/designer/sessions", {}, bearer(token))
      return { envId: res.data.store_environment.id, token, sessionId: session.data.session.id }
    }

    /**
     * Holds the worker at a designer tool call's ai_action insert — after every cancel checkpoint and the
     * lease-fenced budget update, before the tool reads the head — while `during` runs.
     */
    const holdToolCall = async (task: any, runId: string, opIndex: number, during: () => Promise<void>) => {
      const knex: any = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const blocker = await knex.transaction()
      let running: Promise<unknown> | null = null
      try {
        await blocker.raw(
          `INSERT INTO ai_action (id, store_environment_id, run_id, task_id, tool, risk, idempotency_key, status, input, input_hash, actor, started_at)
           VALUES (?, ?, ?, ?, 'theme.update_tokens', 0, ?, 'started', '{}'::jsonb, 'review', '{}'::jsonb, now())`,
          [`aact_review_blocker_${opIndex}`, task.store_environment_id, runId, task.id, `${runId}:designer:op:${opIndex}`]
        )
        running = executeClaimedTask(getContainer(), task, "worker-review")
        let waiting = 0
        for (let i = 0; i < 300 && !waiting; i++) {
          await sleep(100)
          ;[{ n: waiting }] = await sql(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%INSERT INTO ai_action%'`
          )
        }
        expect(waiting).toBeGreaterThan(0)
        await during()
      } finally {
        await blocker.rollback().catch(() => undefined)
      }
      await running
    }

    /** Turns the store's ready dry-run preview into a local artifact a screenshot browser can render. */
    const localPreview = async (s: Store) => {
      process.env.STOREFRONT_DEPLOY_ROOT = shotRoot
      const [d] = await sql(
        `SELECT id FROM storefront_deployment WHERE store_environment_id = ? AND target = 'preview' AND status = 'ready' LIMIT 1`,
        [s.envId]
      )
      const out = path.join(shotRoot, "builds", d.id, "out")
      fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="bg"><body><h1>Преглед</h1></body></html>`)
      await sql(`UPDATE storefront_deployment SET provider = 'local', artifact_ref = ? WHERE id = ?`, [`builds/${d.id}/out`, d.id])
      return d.id as string
    }
    const capture = (s: Store, deploymentId: string, viewport = "mobile") =>
      call(api.post("/merchant/designer/screenshots", { deployment_id: deploymentId, viewport }, bearer(s.token)))

    beforeAll(async () => {
      envSnapshot = { ...process.env }
      const container = getContainer()
      const operator = await createUserWithToken(container, api, "operator@platform.test")
      await registerPlatformOperator(container, operator.user.id)
      maria = await createStore(operator.token, "maria-candles", "Maria Candles")
      petya = await createStore(operator.token, "petya-jewellery", "Petya Jewellery")
    })

    afterEach(() => {
      resetFakeModel()
      for (const key of Object.keys(process.env)) {
        if (!(key in envSnapshot)) delete process.env[key]
      }
      Object.assign(process.env, envSnapshot)
    })

    afterAll(() => {
      fs.rmSync(shotRoot, { recursive: true, force: true })
      // Screenshot PNGs written by the local file provider.
      fs.rmSync(path.join(path.resolve(__dirname, "../.."), "static"), { recursive: true, force: true })
    })

    describe("designer turns always settle", () => {
      it("REVIEW-A1 a turn failed by the run-deadline sweep is settled and does not lock the designer", async () => {
        const sent = await send(maria, "Шрифт модерен")
        expect(sent.status).toBe(202)
        const assistantId = sent.data.assistant_message.id
        // The worker was down longer than the 5-minute turn deadline.
        await sql(`UPDATE ai_run SET deadline_at = now() - interval '1 second' WHERE id = ?`, [await runOf(assistantId)])
        await sweepExpired(getContainer())
        const [run] = await sql(`SELECT status FROM ai_run WHERE id = ?`, [await runOf(assistantId)])
        const settled = await messageStatus(assistantId)
        const head = (await state(maria)).head
        const restore = await call(
          api.post(`/merchant/designer/revisions/${head.id}/restore`, { expected_head_revision_id: head.id }, bearer(maria.token))
        )
        const next = await send(maria, "Опитай пак")
        expect({ run: run.status, message: settled, restore: restore.status, next: next.status }).toEqual({
          run: "failed",
          message: "failed",
          restore: 200,
          next: 202,
        })
        const [message] = (await api.get(`/merchant/designer/sessions/${maria.sessionId}`, bearer(maria.token))).data.session.messages.filter(
          (m: any) => m.id === assistantId
        )
        expect(message).toMatchObject({ status: "failed", error_code: "limit_reached" })
      })

      it("REVIEW-A2 a turn whose lease expires on the final attempt is settled and does not lock the designer", async () => {
        const sent = await send(maria, "Шрифт модерен")
        expect(sent.status).toBe(202)
        const assistantId = sent.data.assistant_message.id
        // Two worker crashes: each claim takes an attempt, then the lease expires.
        for (let attempt = 0; attempt < 2; attempt++) {
          const task = await claimNextTask(getContainer(), `crashing-worker-${attempt}`)
          expect(task).toBeTruthy()
          await sql(`UPDATE ai_task SET lease_expires_at = now() - interval '1 second' WHERE id = ?`, [task.id])
        }
        await sweepExpired(getContainer())
        const next = await send(maria, "Опитай пак")
        expect({ message: await messageStatus(assistantId), next: next.status }).toEqual({ message: "failed", next: 202 })
      })

      it("REVIEW-A3 a turn cancelled by a restore whose worker then died is settled by the sweep", async () => {
        const sent = await send(maria, "Шрифт модерен")
        const assistantId = sent.data.assistant_message.id
        const task = await claimNextTask(getContainer(), "worker-that-dies")
        expect(task).toBeTruthy()
        const head = (await state(maria)).head
        const restore = await call(
          api.post(`/merchant/designer/revisions/${head.id}/restore`, { expected_head_revision_id: head.id }, bearer(maria.token))
        )
        expect(restore.data.cancelled_turns).toBe(1)
        // The worker died before its next checkpoint (an attempt is still left).
        await sql(`UPDATE ai_task SET lease_expires_at = now() - interval '1 second' WHERE id = ?`, [task.id])
        await sweepExpired(getContainer())
        const [taskRow] = await sql(`SELECT status FROM ai_task WHERE id = ?`, [task.id])
        const next = await send(maria, "Опитай пак")
        expect({ task: taskRow.status, message: await messageStatus(assistantId), next: next.status }).toEqual({
          task: "cancelled",
          message: "cancelled",
          next: 202,
        })
      })

      it("REVIEW-A4 a revision conflict raised after a restore cancelled the run is not retried", async () => {
        const sent = await send(maria, "Шрифт модерен")
        const assistantId = sent.data.assistant_message.id
        const runId = await runOf(assistantId)
        // The merchant's restore cancels the run while the turn is running; the turn then hits a revision conflict.
        setFakeOverride("designer.plan", async () => {
          await sql(`UPDATE ai_run SET cancel_requested_at = now() WHERE id = ?`, [runId])
          throw new RevisionConflictError()
        })
        const task = await claimNextTask(getContainer(), "worker-conflict")
        await executeClaimedTask(getContainer(), task, "worker-conflict")
        const [taskRow] = await sql(`SELECT status, attempt FROM ai_task WHERE id = ?`, [task.id])
        await sweepExpired(getContainer())
        expect(await claimNextTask(getContainer(), "worker-after")).toBeNull()
        const next = await send(maria, "Опитай пак")
        expect({ task: taskRow.status, attempt: taskRow.attempt, message: await messageStatus(assistantId), planCalls: planCalls(), next: next.status }).toEqual({
          task: "cancelled",
          attempt: 1,
          message: "cancelled",
          planCalls: 1,
          next: 202,
        })
      })
    })

    describe("restore wins against in-flight designer turns (D8)", () => {
      it("REVIEW-B an AI edit that reads the head after a restore committed does not land on top of the restore", async () => {
        const baseline = (await state(maria)).head
        expect(baseline.config.theme.typography).toBe("editorial")
        setFakeOverride("designer.plan", () => ({
          reply: "Готово.",
          operations: [{ op: "theme.update_tokens", args: { typography: "modern", corner: null, colors: null } }],
        }))
        const sent = await send(maria, "Шрифт модерен")
        expect(sent.status).toBe(202)
        const runId = await runOf(sent.data.assistant_message.id)
        const task = await claimNextTask(getContainer(), "worker-review")
        let restoreStatus = 0
        await holdToolCall(task, runId, 0, async () => {
          const restored = await call(
            api.post(`/merchant/designer/revisions/${baseline.id}/restore`, { expected_head_revision_id: baseline.id }, bearer(maria.token))
          )
          restoreStatus = restored.status
        })
        const after = await state(maria)
        const aiRevisions = await sql(`SELECT id FROM storefront_revision WHERE designer_message_id = ? AND author_type = 'ai'`, [
          sent.data.assistant_message.id,
        ])
        expect({
          restore: restoreStatus,
          typography: after.head.config.theme.typography,
          aiRevisions: aiRevisions.length,
          message: await messageStatus(sent.data.assistant_message.id),
        }).toEqual({ restore: 200, typography: "editorial", aiRevisions: 0, message: "cancelled" })
      })

      it("REVIEW-B2 a restore supersedes AI revisions of the turn it cancels that landed before it", async () => {
        const baseline = (await state(maria)).head
        setFakeOverride("designer.plan", () => ({
          reply: "Готово.",
          operations: [
            { op: "theme.update_tokens", args: { typography: "modern", corner: null, colors: null } },
            { op: "theme.update_tokens", args: { typography: null, corner: "square", colors: null } },
          ],
        }))
        const sent = await send(maria, "Модерен шрифт и прави ъгли")
        const assistantId = sent.data.assistant_message.id
        const runId = await runOf(assistantId)
        const task = await claimNextTask(getContainer(), "worker-review")
        let restoreStatus = 0
        // The first AI edit is committed; the second is held. The merchant restores from the version they saw.
        await holdToolCall(task, runId, 1, async () => {
          const restored = await call(
            api.post(`/merchant/designer/revisions/${baseline.id}/restore`, { expected_head_revision_id: baseline.id }, bearer(maria.token))
          )
          restoreStatus = restored.status
        })
        const after = await state(maria)
        const aiRevisions = await sql(`SELECT id FROM storefront_revision WHERE designer_message_id = ? AND author_type = 'ai'`, [assistantId])
        expect({
          restore: restoreStatus,
          typography: after.head.config.theme.typography,
          corner: after.head.config.theme.corner,
          aiRevisions: aiRevisions.length,
          headIsAi: aiRevisions.some((r: any) => r.id === after.head.id),
          message: await messageStatus(assistantId),
        }).toEqual({ restore: 200, typography: "editorial", corner: "soft", aiRevisions: 1, headIsAi: false, message: "cancelled" })

        // A restore from a stale view that is not explained by a cancelled turn is still a conflict.
        const stale = await call(
          api.post(`/merchant/designer/revisions/${baseline.id}/restore`, { expected_head_revision_id: baseline.id }, bearer(maria.token))
        )
        expect(stale.status).toBe(409)
      })
    })

    describe("screenshot capture concurrency", () => {
      it("REVIEW-S1 parallel captures for one store: one proceeds, the others get 429 busy, and the lock is released", async () => {
        process.env.STOREFRONT_SCREENSHOT_CONCURRENCY = "2"
        const deploymentId = await localPreview(maria)
        const results = await Promise.all([capture(maria, deploymentId), capture(maria, deploymentId, "desktop")])
        const statuses = results.map((r) => r.status).sort()
        expect(statuses).toEqual([201, 429])
        expect(results.find((r) => r.status === 429)!.data).toMatchObject({ type: "rate_limited", kind: "screenshot", reason: "busy" })
        expect((await capture(maria, deploymentId)).status).toBe(201)
        expect((await sql(`SELECT count(*)::int AS n FROM storefront_screenshot WHERE store_environment_id = ?`, [maria.envId]))[0].n).toBe(2)
      })

      it("REVIEW-S2 the process-wide browser cap refuses other stores while a capture runs, and failures release the slot", async () => {
        process.env.STOREFRONT_SCREENSHOT_CONCURRENCY = "1"
        const mariaDeployment = await localPreview(maria)
        const petyaDeployment = await localPreview(petya)
        const results = await Promise.all([capture(maria, mariaDeployment), capture(petya, petyaDeployment)])
        expect(results.map((r) => r.status).sort()).toEqual([201, 429])
        expect(results.find((r) => r.status === 429)!.data).toMatchObject({ kind: "screenshot", reason: "busy" })

        // A capture that times out fails without a row and releases the slot and the store lock.
        process.env.STOREFRONT_SCREENSHOT_TIMEOUT_MS = "1"
        const failed = await capture(maria, mariaDeployment)
        expect(failed.status).toBeGreaterThanOrEqual(500)
        delete process.env.STOREFRONT_SCREENSHOT_TIMEOUT_MS
        expect((await capture(maria, mariaDeployment)).status).toBe(201)
        expect((await capture(petya, petyaDeployment)).status).toBe(201)
      })
    })
  },
})
