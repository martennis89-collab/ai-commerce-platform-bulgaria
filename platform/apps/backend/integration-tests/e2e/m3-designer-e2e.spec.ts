/**
 * M3 end-to-end: the real Amboras admin (`apps/admin`, next build + next start)
 * driven by headless Chromium against the backend, real storefront-core 0.3.0
 * preview builds through the local provider, and Playwright screenshots.
 *
 * - M3-T07 promotion builds a real per-project preview of the edited revision
 * - M3-T08 screenshots come only from the store's own ready artifact
 * - M3-T09 draft edits never reach the served preview until promoted; live hosts do not resolve
 * - M3-T13 framing headers on admin pages, the draft frame and the preview gateway
 * - M3-T15 designer UI per DESIGN.md §6 at 1440 × 900 and 375 × 812
 *
 * UI evidence screenshots are written to M3_UI_EVIDENCE_DIR (default: OS temp).
 */
import { ChildProcess, spawn, spawnSync } from "child_process"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { WORKSPACE_ROOT } from "@platform/storefront-core"
import { findSection } from "@platform/storefront-schema"
import { createSharedRegion } from "../fixtures/commerce"
import { bearer, call, createUserWithToken } from "../fixtures/http"
import { STOREFRONT_MODULE } from "../../src/modules/storefront"
import { TENANCY_MODULE } from "../../src/modules/tenancy"
import { registerPlatformOperator } from "../../src/tenancy/provisioning"
import { createPreviewGateway, resolvePreviewRoute } from "../../src/storefront/deploy/gateway"
import { drainDeployments } from "../../src/storefront/deployments"
import { resetFakeModel, setFakeOverride } from "../../src/ai/model/fake"
import { drainTasks, sweepExpired } from "../../src/ai/worker"
import { sqlRows } from "../../src/ai/sql"

jest.setTimeout(60 * 60 * 1000)

const DEPLOY_ROOT = path.join(WORKSPACE_ROOT, ".local-deployments-e2e-m3")
const ADMIN_DIR = path.join(WORKSPACE_ROOT, "apps", "admin")
const ADMIN_PORT = 7311
const ADMIN_ORIGIN = `http://localhost:${ADMIN_PORT}`
const PASSWORD = "M0-test-password!"
const EVIDENCE_DIR = process.env.M3_UI_EVIDENCE_DIR || path.join(os.tmpdir(), "m3-ui-evidence")
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])
const ENGLISH_UI = /\b(Send|Undo|History|Loading|Preview|Error|Submit|Cancel|Retry|Settings|Dashboard)\b/

// The runner loads medusa-config before it applies `env`, so config-time CORS must be set up front.
process.env.AUTH_CORS = ADMIN_ORIGIN
process.env.MERCHANT_CORS = ADMIN_ORIGIN

medusaIntegrationTestRunner({
  env: {
    STOREFRONT_DEPLOY_PROVIDER: "local",
    PLATFORM_BASE_DOMAIN: "localhost",
    STOREFRONT_DEPLOY_ROOT: DEPLOY_ROOT,
    AI_MODEL_PROVIDER: "fake",
    AI_WORKER_AUTOSTART: "false",
    MERCHANT_CORS: ADMIN_ORIGIN,
    AUTH_CORS: ADMIN_ORIGIN,
  },
  testSuite: ({ api, getContainer }) => {
    type Store = { handle: string; name: string; email: string; envId: string; projectId: string; token: string; sessionId: string }
    const stores: Record<"maria" | "petya", Store> = {
      maria: { handle: "maria-candles", name: "Maria Candles", email: "owner@maria-candles.test", envId: "", projectId: "", token: "", sessionId: "" },
      petya: { handle: "petya-jewellery", name: "Petya Jewellery", email: "owner@petya-jewellery.test", envId: "", projectId: "", token: "", sessionId: "" },
    }
    let gateway: http.Server
    let gatewayPort: number
    let admin: ChildProcess | null = null
    let chromium: any
    let browser: any

    const storefront = () => getContainer().resolve(STOREFRONT_MODULE) as any
    const sql = (q: string, b: unknown[] = []) => sqlRows(getContainer(), q, b)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const fetchHost = (host: string, urlPath = "/") =>
      new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: gatewayPort, path: urlPath, headers: { host } }, (res) => {
          let body = ""
          res.setEncoding("utf8")
          res.on("data", (c) => (body += c))
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
        })
        req.on("error", reject)
        req.end()
      })

    const waitDeployment = async (id: string) => {
      const started = Date.now()
      for (;;) {
        await drainDeployments(getContainer(), { budgetMs: 1_000 })
        const [d] = await storefront().listDeployments({ id })
        if (d && ["ready", "failed", "superseded"].includes(d.status)) return d
        if (Date.now() - started > 20 * 60 * 1000) throw new Error(`deployment ${id} still ${d?.status}`)
        await sleep(1000)
      }
    }

    const settleTurn = async (store: Store) => {
      for (let i = 0; i < 300; i++) {
        await sweepExpired(getContainer())
        await drainTasks(getContainer(), { budgetMs: 20_000, concurrency: 2 })
        const [latest] = await sql(
          `SELECT status FROM ai_designer_message WHERE store_environment_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`,
          [store.envId]
        )
        if (latest && ["completed", "failed", "cancelled"].includes(latest.status)) return latest
        await sleep(200)
      }
      throw new Error("designer turn did not settle")
    }

    const latestPreview = async (store: Store) =>
      (
        await sql(
          `SELECT * FROM storefront_deployment WHERE project_id = ? AND target = 'preview' ORDER BY sequence DESC NULLS LAST, id DESC LIMIT 1`,
          [store.projectId]
        )
      )[0]

    const evidence = async (page: any, name: string) => {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false })
    }

    const signIn = async (page: any, store: Store) => {
      // Browser-side problems are collected so a failed sign-in explains itself instead of timing out silently.
      const problems: string[] = []
      page.on("console", (m: any) => m.type() === "error" && problems.push(`console: ${m.text()}`))
      page.on("pageerror", (e: any) => problems.push(`pageerror: ${e.message}`))
      page.on("requestfailed", (r: any) => problems.push(`requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`))
      page.on("response", (r: any) => r.status() >= 400 && problems.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`))
      try {
        await page.goto(`${ADMIN_ORIGIN}/`)
        await page.getByLabel("Имейл").fill(store.email)
        await page.getByLabel("Парола").fill(PASSWORD)
        await page.getByRole("button", { name: "Вход" }).click()
        await page.locator('iframe[title="Чернова на магазина"]').waitFor({ timeout: 60_000 })
        const frame = page.frameLocator('iframe[title="Чернова на магазина"]')
        await frame.locator('[data-amb-element="section:hero-1/headline"]').waitFor({ timeout: 60_000 })
        return frame
      } catch (error: any) {
        await evidence(page, `signin-failure-${store.handle}`).catch(() => undefined)
        const body = await page.locator("body").innerText().catch(() => "")
        throw new Error(`sign-in failed: ${error.message}\nbody: ${body.slice(0, 500)}\n${problems.join("\n")}`)
      }
    }

    beforeAll(async () => {
      fs.rmSync(DEPLOY_ROOT, { recursive: true, force: true })
      process.env.STOREFRONT_BACKEND_URL = String(api.defaults.baseURL).replace(/\/$/, "")
      const container = getContainer()
      // Storefront builds read calculated prices, which Medusa only serves with a region.
      await createSharedRegion(container)
      const operator = await createUserWithToken(container, api, "operator@platform.test")
      await registerPlatformOperator(container, operator.user.id)

      for (const store of Object.values(stores)) {
        const owner = await createUserWithToken(container, api, store.email, PASSWORD)
        const res = await api.post(
          "/admin/platform/store-environments",
          { handle: store.handle, name: store.name, owner_user_id: owner.user.id },
          bearer(operator.token)
        )
        store.envId = res.data.store_environment.id
        store.projectId = res.data.storefront_project.id
        store.token = owner.token
        const firstBuild = await waitDeployment(res.data.deployment.id)
        expect({ status: firstBuild.status, error: firstBuild.error }).toMatchObject({ status: "ready" })
        await api.post("/merchant/media", { filename: "photo.png", mime_type: "image/png", content_base64: PNG.toString("base64") }, bearer(owner.token))
        store.sessionId = (await api.post("/merchant/designer/sessions", {}, bearer(owner.token))).data.session.id
      }

      gateway = createPreviewGateway({ deployRoot: DEPLOY_ROOT, resolveRoute: (host) => resolvePreviewRoute(getContainer(), host) })
      await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", () => r()))
      gatewayPort = (gateway.address() as any).port

      const build = spawnSync(process.execPath, [require.resolve("next/dist/bin/next", { paths: [ADMIN_DIR] }), "build"], {
        cwd: ADMIN_DIR,
        env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ADMIN_TURBOPACK_ROOT: WORKSPACE_ROOT },
        encoding: "utf8",
        timeout: 15 * 60 * 1000,
      })
      if (build.status !== 0) {
        throw new Error(`admin build failed:\n${(build.stdout ?? "").slice(-3000)}\n${(build.stderr ?? "").slice(-3000)}`)
      }
      admin = spawn(process.execPath, [require.resolve("next/dist/bin/next", { paths: [ADMIN_DIR] }), "start", "-p", String(ADMIN_PORT)], {
        cwd: ADMIN_DIR,
        env: {
          ...process.env,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          AMBORAS_BACKEND_URL: String(api.defaults.baseURL).replace(/\/$/, ""),
        },
        stdio: "ignore",
      })
      for (let i = 0; i < 120; i++) {
        const ok = await fetch(`${ADMIN_ORIGIN}/`).then((r) => r.ok).catch(() => false)
        if (ok) break
        if (i === 119) throw new Error("admin did not start")
        await sleep(500)
      }
      chromium = require("playwright").chromium
      browser = await chromium.launch()
    })

    afterEach(() => resetFakeModel())

    afterAll(async () => {
      await browser?.close().catch(() => undefined)
      admin?.kill()
      if (gateway) await new Promise<void>((r) => gateway.close(() => r()))
      // The deploy root is kept (git-ignored) so build logs survive a failure; beforeAll cleans it on the next run.
    })

    it("M3-T13 framing is refused everywhere except the admin's own draft frame", async () => {
      const home = await fetch(`${ADMIN_ORIGIN}/`)
      expect(home.headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
      expect(home.headers.get("x-frame-options")).toBe("DENY")
      const frame = await fetch(`${ADMIN_ORIGIN}/frame`)
      expect(frame.headers.get("content-security-policy")).toBe("frame-ancestors 'self'")
      expect(frame.headers.get("x-frame-options")).toBe("SAMEORIGIN")
      const preview = await fetchHost(`${stores.maria.handle}.preview.localhost`)
      expect(preview.status).toBe(200)
      expect(preview.headers["content-security-policy"]).toBe("frame-ancestors 'none'")
      // CORS: only the configured admin origin may call the merchant API from a browser.
      const allowed = await fetch(`${api.defaults.baseURL}/merchant/designer`, { method: "OPTIONS", headers: { origin: ADMIN_ORIGIN, "access-control-request-method": "GET" } })
      expect(allowed.headers.get("access-control-allow-origin")).toBe(ADMIN_ORIGIN)
      const denied = await fetch(`${api.defaults.baseURL}/merchant/designer`, { method: "OPTIONS", headers: { origin: "http://evil.example", "access-control-request-method": "GET" } })
      expect(denied.headers.get("access-control-allow-origin")).toBeNull()
    })

    it("M3-T15 + T07 + T09 the designer at 1440px: select, chat, undo, restore, promote to a real preview", async () => {
      const maria = stores.maria
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "bg-BG" })
      const page = await context.newPage()
      const frame = await signIn(page, maria)

      await expect(page.getByText("Посочете елемент от магазина и кажете какво да променим.")).toBeTruthyVisible()
      await evidence(page, "desktop-empty")

      await frame.locator('[data-amb-element="section:hero-1/headline"]').click()
      await page.getByText("Избрано: Заглавие").first().waitFor()

      setFakeOverride("designer.plan", () => ({
        reply: "Смених заглавието.",
        operations: [{ op: "section.update_copy", args: { section_id: "hero-1", field: "headline", item_index: null, value: "Свещи от София" } }],
      }))
      await page.getByLabel("Съобщение").fill("Сменете заглавието на „Свещи от София“")
      await page.getByRole("button", { name: "Изпрати" }).click()
      await page.getByText("Работя по промяната…").waitFor()
      await evidence(page, "desktop-running")
      await settleTurn(maria)
      await page.getByText("Готово: Промених заглавието в „Начален блок“. Версия 2").waitFor({ timeout: 30_000 })
      await frame.getByRole("heading", { level: 1, name: "Свещи от София" }).waitFor({ timeout: 30_000 })
      await evidence(page, "desktop-applied")

      // T09: the served preview still shows the promoted (initial) build, never the draft.
      const beforePromotion = await fetchHost(`${maria.handle}.preview.localhost`)
      expect(beforePromotion.body).toContain("Maria Candles")
      expect(beforePromotion.body).not.toContain("Свещи от София")
      expect((await fetchHost(`${maria.handle}.localhost`)).status).toBe(404)

      await page.getByRole("button", { name: "Отмени" }).first().click()
      await page.getByText("Върнах предишната версия.").waitFor()
      await frame.getByRole("heading", { level: 1, name: "Maria Candles" }).waitFor({ timeout: 30_000 })

      await page.getByRole("button", { name: "История" }).click()
      const drawer = page.getByRole("region", { name: "История" })
      await drawer.getByText("Версия 3").waitFor({ timeout: 30_000 })
      await evidence(page, "desktop-history")
      const versionTwo = drawer.locator("li").filter({ hasText: "Версия 2" })
      await versionTwo.getByRole("button", { name: "Върни тази версия" }).click()
      await versionTwo.getByText("Ще върнем версия 2. Текущата промяна ще бъде спряна, но нищо няма да се изгуби.").waitFor()
      await versionTwo.getByRole("button", { name: "Върни", exact: true }).click()
      await frame.getByRole("heading", { level: 1, name: "Свещи от София" }).waitFor({ timeout: 30_000 })
      await drawer.getByRole("button", { name: "Затвори" }).click()

      // T07: promote the restored head to a real preview build.
      await page.getByRole("button", { name: "Обнови прегледа" }).click()
      await page.getByText("Подготвяме прегледа…").first().waitFor({ timeout: 30_000 })
      const deployment = await latestPreview(maria)
      const built = await waitDeployment(deployment.id)
      expect({ status: built.status, error: built.error }).toMatchObject({ status: "ready" })
      await page.getByText("Прегледът е обновен.").first().waitFor({ timeout: 60_000 })
      const afterPromotion = await fetchHost(`${maria.handle}.preview.localhost`)
      expect(afterPromotion.body).toContain("Свещи от София")
      expect(afterPromotion.body).toContain('data-amb-element="section:hero-1/headline"')
      expect(afterPromotion.body).toContain(`content="${built.revision_id}"`)
      const petyaPreview = await fetchHost(`${stores.petya.handle}.preview.localhost`)
      expect(petyaPreview.body).not.toContain("Свещи от София")

      // Screenshot from the admin (T08 through the UI).
      await page.getByRole("button", { name: "История" }).click()
      await page.getByRole("button", { name: "Снимка: настолен" }).click()
      await page.locator("figure.shot img").first().waitFor({ timeout: 120_000 })
      await evidence(page, "desktop-screenshot-card")

      // DESIGN.md §6 checks.
      const text = await page.locator("body").innerText()
      expect(text).not.toMatch(ENGLISH_UI)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.keyboard.press("Tab")
      const focusOutline = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el ? getComputedStyle(el).outlineStyle : "none"
      })
      expect(focusOutline).not.toBe("none")
      await context.close()
    })

    it("M3-T15 the designer at 375px with reduced motion: tabs, bottom sheet, no overflow, no animation", async () => {
      const petya = stores.petya
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "bg-BG", reducedMotion: "reduce", hasTouch: true })
      const page = await context.newPage()
      const frame = await signIn(page, petya)
      await page.getByRole("tab", { name: "Магазин" }).waitFor()
      await page.getByRole("tab", { name: "Разговор" }).waitFor()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await evidence(page, "mobile-store")

      await frame.locator('[data-amb-element="section:product_grid-1/title"]').click()
      const sheet = page.locator(".sheet")
      await sheet.getByText("Избрано: Заглавие на секцията").waitFor()
      await evidence(page, "mobile-sheet")

      setFakeOverride("designer.plan", () => ({ reply: "Изберете какво точно да променим.", operations: [] }))
      await sheet.getByLabel("Съобщение").fill("Какво може да се промени тук?")
      await sheet.getByRole("button", { name: "Изпрати" }).click()
      await page.getByRole("tab", { name: "Разговор" }).click()
      const dot = page.locator(".status-dot").first()
      if (await dot.count()) {
        expect(await dot.evaluate((el: Element) => getComputedStyle(el).animationName)).toBe("none")
      }
      await settleTurn(petya)
      await page.getByText("Изберете какво точно да променим.").waitFor({ timeout: 30_000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(await page.locator("body").innerText()).not.toMatch(ENGLISH_UI)
      await evidence(page, "mobile-conversation")
      await context.close()
    })

    it("M3-T08 screenshots render only the store's own ready artifact and are owned media", async () => {
      const maria = stores.maria
      const ready = (await sql(`SELECT * FROM storefront_deployment WHERE project_id = ? AND status = 'ready' AND target = 'preview'`, [maria.projectId]))[0]
      expect(ready).toBeTruthy()
      const shot = await call(api.post("/merchant/designer/screenshots", { deployment_id: ready.id, viewport: "mobile" }, bearer(maria.token)))
      expect(shot.status).toBe(201)
      expect(shot.data.screenshot).toMatchObject({ viewport: "mobile", width: 375, height: 812, deployment_id: ready.id, revision_id: ready.revision_id })
      const [row] = await sql(`SELECT * FROM storefront_screenshot WHERE id = ?`, [shot.data.screenshot.id])
      expect(row.size_bytes).toBeGreaterThan(1000)
      const tenancy = getContainer().resolve(TENANCY_MODULE) as any
      expect(await tenancy.listOwnedResourceIds(maria.envId, "media_file")).toContain(row.file_id)
      expect(await tenancy.listOwnedResourceIds(stores.petya.envId, "media_file")).not.toContain(row.file_id)

      expect((await call(api.post("/merchant/designer/screenshots", { deployment_id: ready.id, viewport: "desktop" }, bearer(stores.petya.token)))).status).toBe(404)
      const queued = (await sql(`SELECT id FROM storefront_deployment WHERE project_id = ? AND status <> 'ready' LIMIT 1`, [maria.projectId]))[0]
      if (queued) {
        expect((await call(api.post("/merchant/designer/screenshots", { deployment_id: queued.id, viewport: "desktop" }, bearer(maria.token)))).status).toBe(400)
      }
      process.env.STOREFRONT_MAX_SCREENSHOTS_PER_HOUR = "1"
      const limited = await call(api.post("/merchant/designer/screenshots", { deployment_id: ready.id, viewport: "desktop" }, bearer(maria.token)))
      expect([limited.status, limited.data.kind]).toEqual([429, "screenshot"])
      delete process.env.STOREFRONT_MAX_SCREENSHOTS_PER_HOUR
      const config = (await api.get("/merchant/designer", bearer(maria.token))).data.designer.head.config
      expect(findSection(config, "hero")!.headline).toBe("Свещи от София")
    })
  },
})

// Small helper so visibility assertions read naturally with Playwright locators inside Jest.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeTruthyVisible(): Promise<R>
    }
  }
}
expect.extend({
  async toBeTruthyVisible(locator: any) {
    await locator.first().waitFor({ state: "visible", timeout: 30_000 })
    return { pass: true, message: () => "visible" }
  },
})
