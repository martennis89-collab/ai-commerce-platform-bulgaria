/**
 * Server-built deployment manifest. This is the ONLY input a storefront build
 * receives, so it is where deployment isolation is enforced:
 *
 * - the deployment, project and store environment must agree;
 * - the environment must be active;
 * - the publishable key must be owned by the project's environment, and every
 *   sales channel of that key must be owned by the same environment
 *   (reusing the M0 storefront resolver);
 * - the configuration must pass the strict storefront schema;
 * - the pinned core version must be available.
 *
 * Nothing in a request can influence any field of the manifest.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DeploymentManifest, MANIFEST_VERSION, validateDeploymentManifest } from "@platform/storefront-core"
import { STOREFRONT_MODULE } from "../modules/storefront"
import type StorefrontModuleService from "../modules/storefront/service"
import { resolveStorefrontScope } from "../tenancy/context"
import { storefrontBackendUrl } from "./platform-config"

const violation = (detail: string) =>
  new MedusaError(MedusaError.Types.NOT_ALLOWED, `Deployment isolation violation: ${detail}`)

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
    config: project.config,
  })
}
