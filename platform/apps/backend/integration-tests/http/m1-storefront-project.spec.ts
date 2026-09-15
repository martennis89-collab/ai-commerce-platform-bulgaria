/**
 * M1 — StoreEnvironment + StorefrontProject + preview deployment (dry-run provider).
 * Test ids map to .claude/mission-state/m1-storefront-project/TESTS.json.
 */
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { STOREFRONT_CORE_VERSION } from "@platform/storefront-core"
import { parseStorefrontConfig } from "@platform/storefront-schema"
import { bearer, call, createUserWithToken } from "../fixtures/http"
import { STOREFRONT_MODULE } from "../../src/modules/storefront"
import { TENANCY_MODULE } from "../../src/modules/tenancy"
import { registerPlatformOperator } from "../../src/tenancy/provisioning"
import { buildMerchantExecutionContext } from "../../src/tenancy/context"
import { executeTenantTool, MERCHANT_TOOLS } from "../../src/tenancy/tools"
import { buildDeploymentManifest } from "../../src/storefront/manifest"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { resolvePreviewRoute, startPreviewGateway } from "../../src/storefront/deploy/gateway"
import { executeDeployment } from "../../src/storefront/deployments"
import { sqlRows } from "../../src/ai/sql"
import { ensureHeadRevision } from "../../src/storefront/revisions"
import { provisionStoreEnvironment } from "../../src/tenancy/provisioning"

jest.setTimeout(10 * 60 * 1000)

const BACKEND_URL = "http://backend.internal:9000"

medusaIntegrationTestRunner({
  env: {
    STOREFRONT_DEPLOY_PROVIDER: "dry-run",
    PLATFORM_BASE_DOMAIN: "shops.test",
    STOREFRONT_BACKEND_URL: BACKEND_URL,
  },
  testSuite: ({ api, getContainer }) => {
    type Store = { envId: string; projectId: string; userId: string; token: string; handle: string; name: string }
    let operatorToken: string
    let maria: Store
    let petya: Store

    const storefront = () => getContainer().resolve(STOREFRONT_MODULE) as any
    const tenancy = () => getContainer().resolve(TENANCY_MODULE) as any
    const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)

    const waitForDeployment = async (id: string, timeoutMs = 30000) => {
      const started = Date.now()
      for (;;) {
        const [d] = await storefront().listDeployments({ id })
        if (d && (d.status === "ready" || d.status === "failed")) {
          return d
        }
        if (Date.now() - started > timeoutMs) {
          throw new Error(`deployment ${id} still ${d?.status}`)
        }
        await new Promise((r) => setTimeout(r, 150))
      }
    }

    const projectOf = async (s: Store) => (await storefront().listStorefrontProjects({ id: s.projectId }))[0]
    const keyOf = async (keyId: string) =>
      (await query().graph({ entity: "api_key", fields: ["id", "token"], filters: { id: keyId } })).data[0] as any

    const createStore = async (handle: string, name: string, email: string): Promise<Store> => {
      const container = getContainer()
      const { user, token } = await createUserWithToken(container, api, email)
      const res = await api.post(
        "/admin/platform/store-environments",
        { handle, name, owner_user_id: user.id },
        bearer(operatorToken)
      )
      await waitForDeployment(res.data.deployment.id)
      return {
        envId: res.data.store_environment.id,
        projectId: res.data.storefront_project.id,
        userId: user.id,
        token,
        handle,
        name,
      }
    }

    beforeAll(async () => {
      const container = getContainer()
      const operator = await createUserWithToken(container, api, "operator@platform.test")
      await registerPlatformOperator(container, operator.user.id)
      operatorToken = operator.token
      maria = await createStore("maria-candles", "Maria Candles", "owner@maria.test")
      petya = await createStore("petya-jewellery", "Petya Jewellery", "owner@petya.test")
    })

    describe("creation", () => {
      it("M1-T01a creates StoreEnvironment, owned Medusa bindings, a pinned StorefrontProject and a ready preview deployment", async () => {
        const [env] = await tenancy().listStoreEnvironments({ id: maria.envId })
        expect(env).toMatchObject({ handle: "maria-candles", name: "Maria Candles", hostname: "maria-candles.shops.test", status: "active" })

        const project = await projectOf(maria)
        expect(project).toMatchObject({
          store_environment_id: maria.envId,
          handle: "maria-candles",
          core_version: STOREFRONT_CORE_VERSION,
          deployment_provider: "dry-run",
          preview_hostname: "maria-candles.preview.shops.test",
          live_hostname: "maria-candles.shops.test",
          status: "active",
        })
        expect(parseStorefrontConfig(project.config).store.name).toBe("Maria Candles")

        const owned = async (type: string) => tenancy().listOwnedResourceIds(maria.envId, type)
        const [channels, keys, locations] = await Promise.all([owned("sales_channel"), owned("api_key"), owned("stock_location")])
        expect([channels.length, keys.length, locations.length]).toEqual([1, 1, 1])
        expect(keys).toEqual([project.publishable_api_key_id])
        const { data: keyLinks } = await query().graph({
          entity: "api_key",
          fields: ["id", "type", "sales_channels_link.sales_channel_id"],
          filters: { id: project.publishable_api_key_id },
        })
        expect(keyLinks[0]).toMatchObject({ type: "publishable" })
        expect((keyLinks[0] as any).sales_channels_link.map((l: any) => l.sales_channel_id)).toEqual(channels)

        const [member] = await tenancy().listStoreEnvironmentMembers({ user_id: maria.userId })
        expect(member).toMatchObject({ store_environment_id: maria.envId, role: "owner" })

        const view = await api.get("/merchant/storefront", bearer(maria.token))
        expect(view.data.storefront).toMatchObject({ id: maria.projectId, preview_hostname: "maria-candles.preview.shops.test" })
        expect(view.data.storefront.deployments[0]).toMatchObject({ status: "ready", target: "preview" })
      })

      it("M1-T01b a failure after commerce resources exist compensates everything", async () => {
        const before = {
          envs: (await tenancy().listStoreEnvironments({})).length,
          ownerships: (await tenancy().listResourceOwnerships({}, { take: null })).length,
          projects: (await storefront().listStorefrontProjects({})).length,
          deployments: (await storefront().listDeployments({})).length,
        }
        // Maria's owner is already a member elsewhere: the membership insert (after
        // environment, channel, key, location, ownership and project) violates the unique index.
        const res = await call(
          api.post(
            "/admin/platform/store-environments",
            { handle: "rogue-store", name: "Rogue Store", owner_user_id: maria.userId },
            bearer(operatorToken)
          )
        )
        expect(res.status).toBeGreaterThanOrEqual(400)

        expect(await tenancy().listStoreEnvironments({ handle: "rogue-store" })).toEqual([])
        expect(await storefront().listStorefrontProjects({ handle: "rogue-store" })).toEqual([])
        expect(await getContainer().resolve(Modules.SALES_CHANNEL).listSalesChannels({ name: "Rogue Store Storefront" })).toEqual([])
        expect(await getContainer().resolve(Modules.API_KEY).listApiKeys({ title: "Rogue Store storefront key" })).toEqual([])
        expect(await getContainer().resolve(Modules.STOCK_LOCATION).listStockLocations({ name: "Rogue Store Warehouse" })).toEqual([])
        expect({
          envs: (await tenancy().listStoreEnvironments({})).length,
          ownerships: (await tenancy().listResourceOwnerships({}, { take: null })).length,
          projects: (await storefront().listStorefrontProjects({})).length,
          deployments: (await storefront().listDeployments({})).length,
        }).toEqual(before)
      })

      it("M1-T01c invalid, reserved and duplicate handles are rejected before anything is created", async () => {
        for (const body of [
          { handle: "Maria", name: "X" },
          { handle: "preview", name: "X" },
          { handle: "maria-candles", name: "Duplicate" },
          { handle: "ok-handle", name: "" },
          { handle: "ok-handle", name: "X", store_environment_id: petya.envId },
        ]) {
          const res = await call(api.post("/admin/platform/store-environments", body, bearer(operatorToken)))
          expect({ body, rejected: res.status >= 400 && res.status < 500 }).toEqual({ body, rejected: true })
        }
        expect(await tenancy().listStoreEnvironments({ handle: ["ok-handle", "preview"] })).toEqual([])
        expect((await call(api.post("/admin/platform/store-environments", { handle: "merchant-made", name: "X" }, bearer(maria.token)))).status).toBe(403)
      })
    })

    describe("deployment isolation", () => {
      it("M1-T04 the manifest carries exactly this environment's publishable key and nothing else", async () => {
        const [deployment] = await storefront().listDeployments({ project_id: maria.projectId, status: "ready" })
        const project = await projectOf(maria)
        const mariaKey = await keyOf(project.publishable_api_key_id)
        const petyaKey = await keyOf((await projectOf(petya)).publishable_api_key_id)
        const m = deployment.manifest
        // Manifest v2 (M3) adds the built revision and the server-resolved owned media map.
        expect(Object.keys(m).sort()).toEqual(
          ["backend_url", "config", "core_version", "deployment_id", "hostname", "manifest_version", "media", "project_id", "publishable_key", "revision_id", "store_handle", "target"].sort()
        )
        expect(m.media).toEqual({})
        expect(m.revision_id === null || /^srev_[0-9A-Z]{26}$/.test(m.revision_id)).toBe(true)
        expect(m).toMatchObject({
          deployment_id: deployment.id,
          project_id: maria.projectId,
          store_handle: "maria-candles",
          target: "preview",
          hostname: "maria-candles.preview.shops.test",
          core_version: STOREFRONT_CORE_VERSION,
          backend_url: BACKEND_URL,
          publishable_key: mariaKey.token,
        })
        const serialized = JSON.stringify(m)
        expect(serialized).not.toContain(petyaKey.token)
        expect(serialized).not.toContain(petya.envId)
        expect(serialized).not.toContain("petya")
        expect(serialized.match(/pk_[A-Za-z0-9]+/g)).toEqual([mariaKey.token])
      })

      it("M1-T03a merchants can only redeploy their own preview, with no parameters", async () => {
        const hostile = [
          { store_environment_id: petya.envId },
          { project_id: petya.projectId },
          { publishable_key: (await keyOf((await projectOf(petya)).publishable_api_key_id)).token },
          { target: "live" },
        ]
        for (const body of hostile) {
          const res = await call(api.post("/merchant/storefront/preview-deployments", body, bearer(maria.token)))
          expect({ body, status: res.status }).toEqual({ body, status: 400 })
        }
        expect(
          (await call(api.post(`/admin/platform/store-environments/${petya.envId}/preview-deployments`, {}, bearer(maria.token)))).status
        ).toBe(403)

        const ok = await api.post("/merchant/storefront/preview-deployments", {}, bearer(maria.token))
        expect(ok.status).toBe(202)
        const done = await waitForDeployment(ok.data.deployment.id)
        expect(done).toMatchObject({ status: "ready", store_environment_id: maria.envId, project_id: maria.projectId })
        expect(done.manifest.store_handle).toBe("maria-candles")

        const view = await api.get("/merchant/storefront", bearer(maria.token))
        const body = JSON.stringify(view.data)
        expect(body).not.toContain(petya.projectId)
        expect(body).not.toContain("petya")
        const [older] = await storefront().listDeployments({ project_id: maria.projectId, status: "superseded" })
        expect(older).toBeTruthy()
      })

      it("M1-T03b the typed tool cannot target another environment", async () => {
        const ctx = await buildMerchantExecutionContext(getContainer(), maria.userId)
        const tool = MERCHANT_TOOLS["storefront.request_preview_deployment"]
        await expect(executeTenantTool(ctx, tool, { store_environment_id: petya.envId })).rejects.toThrow(/must not select a tenant/)
        await expect(executeTenantTool(ctx, tool, { project_id: petya.projectId })).rejects.toThrow(/Invalid arguments/)
        const d: any = await executeTenantTool(ctx, tool, {})
        const done = await waitForDeployment(d.id)
        expect(done.store_environment_id).toBe(maria.envId)
      })

      it.each([
        ["Store B's publishable key on Store A's project", "foreign-key"],
        ["Store A's key additionally linked to Store B's sales channel", "corrupt-key"],
        ["a tenant selector injected into the project config", "config-injection"],
        ["an unavailable storefront-core version", "core-version"],
      ])("M1-T03c redeploy fails closed with %s and the provider never runs", async (_label, attack) => {
        const container = getContainer()
        const project = await projectOf(maria)
        const petyaProject = await projectOf(petya)
        if (attack === "foreign-key") {
          await storefront().updateStorefrontProjects({ id: project.id, publishable_api_key_id: petyaProject.publishable_api_key_id })
        } else if (attack === "corrupt-key") {
          const [petyaChannel] = await tenancy().listOwnedResourceIds(petya.envId, "sales_channel")
          await container.resolve(ContainerRegistrationKeys.LINK).create({
            [Modules.API_KEY]: { publishable_key_id: project.publishable_api_key_id },
            [Modules.SALES_CHANNEL]: { sales_channel_id: petyaChannel },
          })
        } else if (attack === "config-injection") {
          // Since M3 builds use the head revision's config (project.config is its mirror): tamper both.
          const head = await ensureHeadRevision(container, project.id, maria.envId)
          await storefront().updateStorefrontProjects({ id: project.id, config: { ...project.config, store_environment_id: petya.envId } })
          await sqlRows(container, `UPDATE storefront_revision SET config = ?::jsonb WHERE id = ?`, [
            JSON.stringify({ ...head.config, store_environment_id: petya.envId }),
            head.id,
          ])
        } else {
          await storefront().updateStorefrontProjects({ id: project.id, core_version: "9.9.9" })
        }
        const res = await api.post(`/admin/platform/store-environments/${maria.envId}/preview-deployments`, {}, bearer(operatorToken))
        const done = await waitForDeployment(res.data.deployment.id)
        expect(done.status).toBe("failed")
        expect(done.artifact_ref).toBeNull()
        expect(done.manifest).toBeNull()
        expect(done.error).toMatch(
          attack === "config-injection" ? /config/ : attack === "core-version" ? /core_version/ : /Deployment isolation violation/
        )
      })

      it("M1-T03d deployment rows whose hostname or environment disagree with the project are refused", async () => {
        const project = await projectOf(maria)
        const wrongHost = await storefront().createDeployments({
          project_id: project.id,
          store_environment_id: maria.envId,
          target: "preview",
          status: "queued",
          provider: "dry-run",
          core_version: STOREFRONT_CORE_VERSION,
          hostname: "petya-jewellery.preview.shops.test",
        })
        await expect(buildDeploymentManifest(getContainer(), wrongHost.id)).rejects.toThrow(/hostname/)
        const wrongEnv = await storefront().createDeployments({
          project_id: project.id,
          store_environment_id: petya.envId,
          target: "preview",
          status: "queued",
          provider: "dry-run",
          core_version: STOREFRONT_CORE_VERSION,
          hostname: project.preview_hostname,
        })
        await expect(buildDeploymentManifest(getContainer(), wrongEnv.id)).rejects.toThrow(/different store environments/)
      })
    })

    describe("hostnames", () => {
      it("M1-T05 preview hosts resolve only their own ready deployment; live, look-alike, unknown and suspended hosts do not", async () => {
        const container = getContainer()
        const [mariaReady] = await storefront().listDeployments({ project_id: maria.projectId, status: "ready" })
        const [petyaReady] = await storefront().listDeployments({ project_id: petya.projectId, status: "ready" })
        expect((await resolvePreviewRoute(container, "maria-candles.preview.shops.test"))?.deployment_id).toBe(mariaReady.id)
        expect((await resolvePreviewRoute(container, "MARIA-CANDLES.preview.shops.test:8787"))?.deployment_id).toBe(mariaReady.id)
        expect((await resolvePreviewRoute(container, "petya-jewellery.preview.shops.test"))?.deployment_id).toBe(petyaReady.id)
        for (const host of [
          "maria-candles.shops.test",
          "maria-candles.preview.shops.test.evil.com",
          "evil-maria-candles.preview.shops.test",
          "preview.shops.test",
          "maria-candles.preview.shops.test/x",
          undefined,
        ]) {
          expect({ host, route: await resolvePreviewRoute(container, host) }).toEqual({ host, route: null })
        }
        expect((await tenancy().resolveStoreEnvironmentByHostname("maria-candles.shops.test"))?.id).toBe(maria.envId)

        await tenancy().updateStoreEnvironments({ id: maria.envId, status: "suspended" })
        expect(await resolvePreviewRoute(container, "maria-candles.preview.shops.test")).toBeNull()
        expect((await resolvePreviewRoute(container, "petya-jewellery.preview.shops.test"))?.deployment_id).toBe(petyaReady.id)
        const res = await api.post(`/admin/platform/store-environments/${maria.envId}/preview-deployments`, {}, bearer(operatorToken))
        expect((await waitForDeployment(res.data.deployment.id)).status).toBe("failed")
      })

      it("M1-T07 each ready deployment has its own artifact and no hostname serves two environments", async () => {
        const ready = await storefront().listDeployments({ status: "ready" }, { take: null })
        const artifacts = ready.map((d: any) => d.artifact_ref)
        expect(new Set(artifacts).size).toBe(artifacts.length)
        const hostsToEnvs = new Map<string, Set<string>>()
        for (const d of ready) {
          hostsToEnvs.set(d.hostname, (hostsToEnvs.get(d.hostname) ?? new Set()).add(d.store_environment_id))
        }
        expect([...hostsToEnvs.values()].every((s) => s.size === 1)).toBe(true)
      })
    })

    describe("independent review hardening", () => {
      it("M1-R1 the runnable gateway entry point serves a ready deployment resolved from the database", async () => {
        const container = getContainer()
        const [ready] = await storefront().listDeployments({ project_id: maria.projectId, status: "ready" })
        // Since M3 (D11) the gateway serves only builds/<deployment_id>/out; dry-run deployments record no such artifact.
        const artifactRef = `builds/${ready.id}/out`
        await storefront().updateDeployments({ id: ready.id, artifact_ref: artifactRef })
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "m1-r1-"))
        fs.mkdirSync(path.join(root, artifactRef), { recursive: true })
        fs.writeFileSync(path.join(root, artifactRef, "index.html"), "<h1>Maria Candles preview</h1>")
        const server = await startPreviewGateway(container, { port: 0, host: "127.0.0.1", deployRoot: root })
        try {
          const port = (server.address() as any).port
          const fetchHost = (host: string) =>
            new Promise<{ status: number; body: string }>((resolve, reject) => {
              const req = http.request({ host: "127.0.0.1", port, path: "/", headers: { host } }, (res) => {
                let body = ""
                res.on("data", (c) => (body += c))
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
              })
              req.on("error", reject)
              req.end()
            })
          expect(await fetchHost("maria-candles.preview.shops.test")).toMatchObject({ status: 200, body: "<h1>Maria Candles preview</h1>" })
          expect((await fetchHost("petya-jewellery.preview.shops.test")).status).toBe(404)
          expect((await fetchHost("maria-candles.shops.test")).status).toBe(404)
        } finally {
          await new Promise<void>((r) => server.close(() => r()))
        }
      })

      it("M1-N1 hostname collisions and concurrent creation leave no orphan organizations", async () => {
        const orgsNamed = async (name: string) => (await tenancy().listOrganizations({ name })).length
        await provisionStoreEnvironment(getContainer(), {
          organizationName: "Pre Org",
          handle: "pre-existing",
          name: "Pre",
          hostname: "collide-store.shops.test",
        })
        const collide = await call(
          api.post("/admin/platform/store-environments", { handle: "collide-store", name: "Collide Store" }, bearer(operatorToken))
        )
        expect(collide.status).toBeGreaterThanOrEqual(400)
        expect(await orgsNamed("Collide Store")).toBe(0)

        const results = await Promise.all(
          [1, 2, 3].map(() =>
            call(api.post("/admin/platform/store-environments", { handle: "race-store", name: "Race Store" }, bearer(operatorToken)))
          )
        )
        expect(results.filter((r) => r.status === 201)).toHaveLength(1)
        expect(await tenancy().listStoreEnvironments({ handle: "race-store" })).toHaveLength(1)
        expect(await orgsNamed("Race Store")).toBe(1)
        expect(await getContainer().resolve(Modules.SALES_CHANNEL).listSalesChannels({ name: "Race Store Storefront" })).toHaveLength(1)
        expect(await getContainer().resolve(Modules.API_KEY).listApiKeys({ title: "Race Store storefront key" })).toHaveLength(1)
      })

      it("M1-N3 an older deployment that finishes later never replaces a newer ready one", async () => {
        const container = getContainer()
        const project = await projectOf(maria)
        // Since M3 (D11) "newer" means a higher per-project sequence, allocated like requestPreviewDeployment does.
        const row = async () => {
          const [{ deployment_sequence }] = await sqlRows(
            container,
            `UPDATE storefront_project SET deployment_sequence = deployment_sequence + 1 WHERE id = ? RETURNING deployment_sequence`,
            [project.id]
          )
          return storefront().createDeployments({
            project_id: project.id,
            store_environment_id: maria.envId,
            target: "preview",
            status: "queued",
            provider: "dry-run",
            core_version: STOREFRONT_CORE_VERSION,
            hostname: project.preview_hostname,
            sequence: deployment_sequence,
          })
        }
        const older = await row()
        const newer = await row()
        expect(newer.id > older.id).toBe(true)
        await executeDeployment(container, newer.id)
        await executeDeployment(container, older.id)
        const [o] = await storefront().listDeployments({ id: older.id })
        const [n] = await storefront().listDeployments({ id: newer.id })
        expect({ older: o.status, newer: n.status }).toEqual({ older: "superseded", newer: "ready" })
        expect(await storefront().listDeployments({ project_id: project.id, status: "ready" })).toHaveLength(1)
        expect((await resolvePreviewRoute(container, project.preview_hostname))?.deployment_id).toBe(newer.id)
      })

      it("M1-N4 revoking the project's publishable key stops its preview being served", async () => {
        const container = getContainer()
        const project = await projectOf(maria)
        await container.resolve(Modules.API_KEY).revoke(project.publishable_api_key_id, { revoked_by: "test", revoke_in: 0 } as any)
        expect(await resolvePreviewRoute(container, "maria-candles.preview.shops.test")).toBeNull()
        expect(await resolvePreviewRoute(container, "petya-jewellery.preview.shops.test")).not.toBeNull()
      })

      it("M1-N5 merchants see a generic deployment error; raw build detail stays operator-side", async () => {
        const project = await projectOf(maria)
        await storefront().updateStorefrontProjects({ id: project.id, core_version: "9.9.9" })
        const res = await api.post("/merchant/storefront/preview-deployments", {}, bearer(maria.token))
        const done = await waitForDeployment(res.data.deployment.id)
        expect(done.error).toMatch(/core_version 9\.9\.9/)
        const view = await api.get("/merchant/storefront", bearer(maria.token))
        const failed = view.data.storefront.deployments.find((d: any) => d.id === done.id)
        expect(failed).toMatchObject({ status: "failed", error: "Deployment failed" })
        // The pinned core_version is legitimately visible; the raw manifest/build error text is not.
        const body = JSON.stringify(view.data)
        expect(body).not.toContain("Invalid deployment manifest")
        expect(body).not.toContain("is not available")
        expect(body).not.toContain(BACKEND_URL)
      })
    })
  },
})
