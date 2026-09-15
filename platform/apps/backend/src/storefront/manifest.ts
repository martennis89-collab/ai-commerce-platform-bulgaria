/**
 * Server-built deployment manifest. This is the ONLY input a storefront build
 * receives, so it is where deployment isolation is enforced:
 *
 * - the deployment, project, revision and store environment must agree;
 * - the environment must be active;
 * - the publishable key must be owned by the project's environment, and every
 *   sales channel of that key must be owned by the same environment
 *   (reusing the M0 storefront resolver);
 * - every photo the configuration references must be a media asset owned by the
 *   same environment; its URL comes from the server, never from configuration;
 * - the configuration must pass the strict storefront schema;
 * - the pinned core version must be available.
 *
 * Nothing in a request can influence any field of the manifest.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DeploymentManifest, MANIFEST_VERSION, validateDeploymentManifest } from "@platform/storefront-core"
import { mediaIdsOf, parseStorefrontConfig } from "@platform/storefront-schema"
import { AI_MODULE } from "../modules/ai"
import type AiModuleService from "../modules/ai/service"
import { STOREFRONT_MODULE } from "../modules/storefront"
import type StorefrontModuleService from "../modules/storefront/service"
import { resolveStorefrontScope } from "../tenancy/context"
import { TENANCY_MODULE } from "../modules/tenancy"
import type TenancyModuleService from "../modules/tenancy/service"
import { storefrontBackendUrl } from "./platform-config"
import { ensureHeadRevision, getOwnedRevision } from "./revisions"

const violation = (detail: string) =>
  new MedusaError(MedusaError.Types.NOT_ALLOWED, `Deployment isolation violation: ${detail}`)

/** Owned media id → URL for a config, failing closed on anything not owned by the environment. */
export async function resolveOwnedMedia(
  container: MedusaContainer,
  storeEnvironmentId: string,
  mediaIds: string[]
): Promise<Record<string, { url: string }>> {
  if (!mediaIds.length) {
    return {}
  }
  const ai: AiModuleService = container.resolve(AI_MODULE)
  const assets = (await ai.listMediaAssets({ id: mediaIds, store_environment_id: storeEnvironmentId })) as any[]
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  const owners = await tenancy.getOwners(
    "media_file",
    assets.map((a) => a.file_id)
  )
  const media: Record<string, { url: string }> = {}
  for (const id of mediaIds) {
    const asset = assets.find((a) => a.id === id)
    if (!asset || owners.get(asset.file_id) !== storeEnvironmentId) {
      throw violation("config references media that is not owned by the store environment")
    }
    media[id] = { url: asset.url }
  }
  return media
}

export async function buildDeploymentManifest(
  container: MedusaContainer,
  deploymentId: string
): Promise<DeploymentManifest> {
  const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
  const [deployment] = (await storefront.listDeployments(
    { id: deploymentId },
    { relations: ["project"] }
  )) as any[]
  if (!deployment?.project) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "deployment not found")
  }
  const project = deployment.project
  if (project.store_environment_id !== deployment.store_environment_id) {
    throw violation("deployment and project belong to different store environments")
  }
  if (project.status !== "active") {
    throw violation("storefront project is not active")
  }
  const expectedHostname =
    deployment.target === "preview" ? project.preview_hostname : project.live_hostname
  if (deployment.hostname !== expectedHostname) {
    throw violation("deployment hostname does not match the project's hostname for its target")
  }

  let revision
  try {
    revision = deployment.revision_id
      ? await getOwnedRevision(container, project.store_environment_id, deployment.revision_id)
      : await ensureHeadRevision(container, project.id, project.store_environment_id)
  } catch {
    throw violation("deployment revision does not belong to the project's store environment")
  }
  if (revision.project_id !== project.id) {
    throw violation("deployment revision belongs to another project")
  }
  const config = parseStorefrontConfig(revision.config)

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "type", "revoked_at"],
    filters: { id: project.publishable_api_key_id },
  })
  const key: any = keys[0]
  if (!key || key.type !== "publishable") {
    throw violation("project publishable key is missing")
  }
  let scopeEnvironmentId: string
  try {
    scopeEnvironmentId = (await resolveStorefrontScope(container, key.token)).storeEnvironmentId
  } catch {
    throw violation("project publishable key is not bound to an active store environment")
  }
  if (scopeEnvironmentId !== project.store_environment_id) {
    throw violation("project publishable key belongs to another store environment")
  }

  return validateDeploymentManifest({
    manifest_version: MANIFEST_VERSION,
    deployment_id: deployment.id,
    project_id: project.id,
    store_handle: project.handle,
    target: deployment.target,
    hostname: expectedHostname,
    core_version: project.core_version,
    backend_url: storefrontBackendUrl(),
    publishable_key: key.token,
    revision_id: revision.id,
    media: await resolveOwnedMedia(container, project.store_environment_id, mediaIdsOf(config)),
    config,
  })
}
