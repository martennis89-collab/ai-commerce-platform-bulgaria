/**
 * Tenant-scoped storefront service. Bound to the ExecutionContext environment;
 * no method accepts a project, deployment, key or environment identifier.
 */
import { MedusaError } from "@medusajs/framework/utils"
import { STOREFRONT_MODULE } from "../modules/storefront"
import type StorefrontModuleService from "../modules/storefront/service"
import { requestPreviewDeployment } from "../storefront/deployments"
import { ExecutionContext, requirePermission } from "./context"

const safeDeployment = (d: any) => ({
  id: d.id,
  target: d.target,
  status: d.status,
  core_version: d.core_version,
  url: d.url ?? null,
  error: d.error ?? null,
  created_at: d.created_at,
  finished_at: d.finished_at ?? null,
})

export function merchantStorefront(ctx: ExecutionContext) {
  const scope = ctx.scope
  const storefront = (): StorefrontModuleService => scope.container.resolve(STOREFRONT_MODULE)

  return {
    async getStorefront() {
      requirePermission(ctx, "storefront:read")
      const [project] = (await storefront().listStorefrontProjects({
        store_environment_id: scope.storeEnvironmentId,
      })) as any[]
      if (!project) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "storefront project not found")
      }
      const deployments = (await storefront().listDeployments(
        { project_id: project.id, store_environment_id: scope.storeEnvironmentId },
        { order: { created_at: "DESC" }, take: 20 }
      )) as any[]
      return {
        id: project.id,
        handle: project.handle,
        status: project.status,
        core_version: project.core_version,
        preview_hostname: project.preview_hostname,
        live_hostname: project.live_hostname,
        config: project.config,
        deployments: deployments.map(safeDeployment),
      }
    },

    async requestPreviewDeployment() {
      requirePermission(ctx, "storefront:deploy")
      return safeDeployment(await requestPreviewDeployment(scope.container, scope.storeEnvironmentId))
    },
  }
}
