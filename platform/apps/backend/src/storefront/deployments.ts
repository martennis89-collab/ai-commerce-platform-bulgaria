/**
 * Storefront deployment lifecycle: queued → building → ready | failed | superseded.
 *
 * Durable lane (M2): a deployment is executed only by the holder of an atomic
 * Postgres lease (fencing token). A crashed build's lease expires and any
 * worker re-claims it; a stale holder can never mark it ready or failed.
 *
 * M3:
 * - every deployment builds one storefront revision (the project head unless a
 *   revision is named) and gets a monotonic per-project `sequence`;
 * - at most one deployment per project and target stays `ready`: the newest by
 *   sequence, even when an older deployment finishes later; for preview it also
 *   decides the project's preview revision;
 * - preview requests are rate limited per store environment.
 */
import { randomUUID } from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { STOREFRONT_MODULE } from "../modules/storefront"
import type StorefrontModuleService from "../modules/storefront/service"
import { sqlRows } from "../ai/sql"
import { getDeployProvider } from "./deploy/provider"
import { buildDeploymentManifest } from "./manifest"
import { NEWEST_DEPLOYMENT_ORDER } from "./ordering"
import { assertWithinRateLimit } from "./rate-limits"
import { ensureHeadRevision, getOwnedRevision } from "./revisions"

export const STOREFRONT_DEPLOYMENT_QUEUED = "storefront.deployment.queued"

/** Longer than the local build timeout (10 min), so a live build never loses its lease. */
const DEPLOYMENT_LEASE_MS = 15 * 60 * 1000
const MAX_DEPLOYMENT_ATTEMPTS = 3

/** Trusted internal entry point: callers must already have established the environment server-side. */
export async function requestPreviewDeployment(
  container: MedusaContainer,
  storeEnvironmentId: string,
  options: { requestKey?: string; revisionId?: string; requestedBy?: string | null } = {}
) {
  const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
  const [project] = (await storefront.listStorefrontProjects({
    store_environment_id: storeEnvironmentId,
    status: "active",
  })) as any[]
  if (!project) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "storefront project not found")
  }
  if (options.requestKey) {
    const [existing] = (await storefront.listDeployments({
      request_key: options.requestKey,
      store_environment_id: storeEnvironmentId,
    } as any)) as any[]
    if (existing) {
      return existing
    }
  }
  const revision = options.revisionId
    ? await getOwnedRevision(container, storeEnvironmentId, options.revisionId)
    : await ensureHeadRevision(container, project.id, storeEnvironmentId)
  if (revision.project_id !== project.id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "storefront revision not found")
  }
  await assertWithinRateLimit(container, storeEnvironmentId, "preview_deploy")
  const [{ deployment_sequence }] = await sqlRows(
    container,
    `UPDATE storefront_project SET deployment_sequence = deployment_sequence + 1, updated_at = now()
      WHERE id = ? RETURNING deployment_sequence`,
    [project.id]
  )
  const deployment = await storefront.createDeployments({
    project_id: project.id,
    store_environment_id: project.store_environment_id,
    target: "preview",
    status: "queued",
    provider: project.deployment_provider,
    core_version: project.core_version,
    hostname: project.preview_hostname,
    request_key: options.requestKey ?? null,
    sequence: deployment_sequence,
    revision_id: revision.id,
    requested_by: options.requestedBy ?? null,
  } as any)
  await container.resolve(Modules.EVENT_BUS).emit({
    name: STOREFRONT_DEPLOYMENT_QUEUED,
    data: { id: (deployment as any).id },
  })
  return deployment as any
}

/** Atomically leases a runnable deployment (a specific one, or the oldest). */
export async function claimDeployment(container: MedusaContainer, workerId: string, deploymentId?: string) {
  const token = randomUUID()
  const rows = await sqlRows(
    container,
    `UPDATE storefront_deployment d
        SET status = 'building', lease_owner = ?, lease_token = ?,
            lease_expires_at = now() + (? * interval '1 millisecond'),
            attempts = d.attempts + 1, started_at = now(), updated_at = now()
      WHERE d.id = (
        SELECT c.id FROM storefront_deployment c
         WHERE c.deleted_at IS NULL
           AND c.attempts < ?
           AND (c.status = 'queued' OR (c.status = 'building' AND c.lease_expires_at < now()))
           ${deploymentId ? "AND c.id = ?" : ""}
         ORDER BY c.id
         FOR UPDATE OF c SKIP LOCKED
         LIMIT 1
      )
      RETURNING d.*`,
    deploymentId
      ? [workerId, token, DEPLOYMENT_LEASE_MS, MAX_DEPLOYMENT_ATTEMPTS, deploymentId]
      : [workerId, token, DEPLOYMENT_LEASE_MS, MAX_DEPLOYMENT_ATTEMPTS]
  )
  return rows[0] ?? null
}

/** Executes a claimed deployment; every write is fenced by the claim's lease token. */
export async function runLeasedDeployment(container: MedusaContainer, deployment: any) {
  const token = deployment.lease_token
  try {
    const manifest = await buildDeploymentManifest(container, deployment.id)
    await sqlRows(
      container,
      `UPDATE storefront_deployment SET manifest = ?::jsonb, revision_id = coalesce(revision_id, ?), updated_at = now()
        WHERE id = ? AND lease_token = ?`,
      [JSON.stringify(manifest), manifest.revision_id, deployment.id, token]
    )
    const provider = getDeployProvider(deployment.provider)
    const result = await provider.deploy(manifest)
    const marked = await sqlRows(
      container,
      `UPDATE storefront_deployment
          SET status = 'ready', artifact_ref = ?, url = ?, error = NULL, finished_at = now(),
              lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = ? AND lease_token = ?
        RETURNING id`,
      [result.artifact_ref, result.url, deployment.id, token]
    )
    if (marked.length) {
      await settleReadyDeployments(container, deployment.project_id, deployment.target)
    }
  } catch (e: any) {
    await sqlRows(
      container,
      `UPDATE storefront_deployment
          SET status = 'failed', error = ?, finished_at = now(),
              lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = ? AND lease_token = ?`,
      [String(e?.message ?? e).slice(0, 2000), deployment.id, token]
    )
  }
}

/** Executes a specific deployment if it is runnable (idempotent: no-op when already claimed or done). */
export async function executeDeployment(container: MedusaContainer, deploymentId: string) {
  const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
  const claimed = await claimDeployment(container, `deploy-${process.pid}`, deploymentId)
  if (claimed) {
    await runLeasedDeployment(container, claimed)
  }
  return ((await storefront.listDeployments({ id: deploymentId })) as any[])[0]
}

/** Drains queued deployments and re-claims builds whose lease expired (crash recovery). */
export async function drainDeployments(container: MedusaContainer, options: { budgetMs?: number } = {}) {
  const deadline = Date.now() + (options.budgetMs ?? 55_000)
  let executed = 0
  while (Date.now() < deadline) {
    const claimed = await claimDeployment(container, `deploy-${process.pid}`)
    if (!claimed) {
      break
    }
    await runLeasedDeployment(container, claimed)
    executed++
  }
  await sqlRows(
    container,
    `UPDATE storefront_deployment SET status = 'failed', error = 'lease expired after final attempt', finished_at = now(),
            lease_token = NULL, lease_owner = NULL, updated_at = now()
      WHERE deleted_at IS NULL AND status = 'building' AND lease_expires_at < now() AND attempts >= ?`,
    [MAX_DEPLOYMENT_ATTEMPTS]
  )
  return executed
}

export { NEWEST_DEPLOYMENT_ORDER }

/**
 * Keeps only the newest ready deployment of a project/target; every older ready
 * one is superseded. For preview, the newest ready deployment's revision becomes
 * the project's preview revision. Serialised per project.
 */
export async function settleReadyDeployments(container: MedusaContainer, projectId: string, target: string) {
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await knex.transaction(async (trx: any) => {
    const q = async (sql: string, b: unknown[]) => ((await trx.raw(sql, b))?.rows ?? []) as any[]
    await q(`SELECT pg_advisory_xact_lock(hashtext(?))`, [`storefront_settle:${projectId}`])
    const [newest] = await q(
      `SELECT id, revision_id FROM storefront_deployment
        WHERE project_id = ? AND target = ? AND status = 'ready' AND deleted_at IS NULL
        ORDER BY ${NEWEST_DEPLOYMENT_ORDER} LIMIT 1`,
      [projectId, target]
    )
    if (!newest) {
      return
    }
    await q(
      `UPDATE storefront_deployment SET status = 'superseded', updated_at = now()
        WHERE project_id = ? AND target = ? AND status = 'ready' AND deleted_at IS NULL AND id <> ?`,
      [projectId, target, newest.id]
    )
    if (target === "preview" && newest.revision_id) {
      await q(
        `UPDATE storefront_revision SET state = 'superseded', updated_at = now()
          WHERE project_id = ? AND state = 'preview' AND id <> ?`,
        [projectId, newest.revision_id]
      )
      await q(`UPDATE storefront_revision SET state = 'preview', updated_at = now() WHERE id = ? AND project_id = ?`, [
        newest.revision_id,
        projectId,
      ])
      await q(`UPDATE storefront_project SET preview_revision_id = ?, updated_at = now() WHERE id = ?`, [
        newest.revision_id,
        projectId,
      ])
    }
  })
}
