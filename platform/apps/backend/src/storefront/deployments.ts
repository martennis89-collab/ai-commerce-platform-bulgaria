/**
 * Storefront deployment lifecycle: queued → building → ready | failed | superseded.
 * At most one deployment per project and target stays `ready`: the newest one
 * (Medusa ids are time-ordered ULIDs), even when an older deployment finishes
 * later. Durable, resumable execution arrives with M2; M1 executes from the
 * `storefront.deployment.queued` subscriber.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { STOREFRONT_MODULE } from "../modules/storefront"
import type StorefrontModuleService from "../modules/storefront/service"
import { getDeployProvider } from "./deploy/provider"
import { buildDeploymentManifest } from "./manifest"

export const STOREFRONT_DEPLOYMENT_QUEUED = "storefront.deployment.queued"

/** Trusted internal entry point: callers must already have established the environment server-side. */
export async function requestPreviewDeployment(container: MedusaContainer, storeEnvironmentId: string) {
  const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
  const [project] = (await storefront.listStorefrontProjects({
    store_environment_id: storeEnvironmentId,
    status: "active",
  })) as any[]
  if (!project) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "storefront project not found")
  }
  const deployment = await storefront.createDeployments({
    project_id: project.id,
    store_environment_id: project.store_environment_id,
    target: "preview",
    status: "queued",
    provider: project.deployment_provider,
    core_version: project.core_version,
    hostname: project.preview_hostname,
  } as any)
  await container.resolve(Modules.EVENT_BUS).emit({
    name: STOREFRONT_DEPLOYMENT_QUEUED,
    data: { id: (deployment as any).id },
  })
  return deployment as any
}

export async function executeDeployment(container: MedusaContainer, deploymentId: string) {
  const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
  const load = async () => ((await storefront.listDeployments({ id: deploymentId })) as any[])[0]
  const deployment = await load()
  if (!deployment || deployment.status !== "queued") {
    return deployment
  }
  await storefront.updateDeployments({ id: deploymentId, status: "building", started_at: new Date() } as any)
  try {
    const manifest = await buildDeploymentManifest(container, deploymentId)
    await storefront.updateDeployments({ id: deploymentId, manifest } as any)
    const provider = getDeployProvider(deployment.provider)
    const result = await provider.deploy(manifest)
    await storefront.updateDeployments({
      id: deploymentId,
      status: "ready",
      artifact_ref: result.artifact_ref,
      url: result.url,
      error: null,
      finished_at: new Date(),
    } as any)
    await settleReadyDeployments(storefront, deployment.project_id, deployment.target)
  } catch (e: any) {
    await storefront.updateDeployments({
      id: deploymentId,
      status: "failed",
      error: String(e?.message ?? e).slice(0, 2000),
      finished_at: new Date(),
    } as any)
  }
  return load()
}

/** Keeps only the newest ready deployment of a project/target; every older ready one is superseded. */
async function settleReadyDeployments(storefront: StorefrontModuleService, projectId: string, target: string) {
  const ready = (await storefront.listDeployments(
    { project_id: projectId, target, status: "ready" } as any,
    { order: { id: "DESC" }, take: null }
  )) as any[]
  const [, ...older] = ready
  if (older.length) {
    await storefront.updateDeployments(older.map((d) => ({ id: d.id, status: "superseded" })) as any)
  }
}
