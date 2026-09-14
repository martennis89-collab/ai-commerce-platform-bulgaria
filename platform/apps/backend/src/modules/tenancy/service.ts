import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import {
  Organization,
  OwnedResourceType,
  PlatformOperator,
  ResourceOwnership,
  Shopper,
  StoreEnvironment,
  StoreEnvironmentMember,
} from "./models"
import { normalizeHostname } from "../../tenancy/hostname"

class TenancyModuleService extends MedusaService({
  Organization,
  StoreEnvironment,
  ResourceOwnership,
  StoreEnvironmentMember,
  PlatformOperator,
  Shopper,
}) {
  /** Returns owner StoreEnvironment id per resource id (missing = unowned). */
  async getOwners(
    type: OwnedResourceType,
    resourceIds: string[]
  ): Promise<Map<string, string>> {
    const ids = [...new Set(resourceIds.filter(Boolean))]
    const owners = new Map<string, string>()
    if (!ids.length) {
      return owners
    }
    const rows = await this.listResourceOwnerships(
      { resource_type: type, resource_id: ids },
      { select: ["resource_id", "store_environment_id"], take: null }
    )
    for (const row of rows as any[]) {
      owners.set(row.resource_id, row.store_environment_id)
    }
    return owners
  }

  async listOwnedResourceIds(
    storeEnvironmentId: string,
    type: OwnedResourceType
  ): Promise<string[]> {
    const rows = await this.listResourceOwnerships(
      { resource_type: type, store_environment_id: storeEnvironmentId },
      { select: ["resource_id"], take: null }
    )
    return (rows as any[]).map((r) => r.resource_id)
  }

  /**
   * Idempotently records ownership. Claiming a resource already owned by a
   * different environment is an isolation violation and throws.
   */
  async claimResources(
    storeEnvironmentId: string,
    type: OwnedResourceType,
    resourceIds: string[]
  ): Promise<string[]> {
    const ids = [...new Set(resourceIds.filter(Boolean))]
    const owners = await this.getOwners(type, ids)
    const conflicting = ids.filter(
      (id) => owners.has(id) && owners.get(id) !== storeEnvironmentId
    )
    if (conflicting.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Tenant isolation violation: ${type} already owned by another store environment`
      )
    }
    const toCreate = ids.filter((id) => !owners.has(id))
    if (toCreate.length) {
      await this.createResourceOwnerships(
        toCreate.map((resource_id) => ({
          resource_type: type,
          resource_id,
          store_environment_id: storeEnvironmentId,
        }))
      )
    }
    return toCreate
  }

  async releaseResources(type: OwnedResourceType, resourceIds: string[]) {
    if (!resourceIds.length) {
      return
    }
    const rows = await this.listResourceOwnerships(
      { resource_type: type, resource_id: resourceIds },
      { select: ["id"], take: null }
    )
    await this.deleteResourceOwnerships((rows as any[]).map((r) => r.id))
  }

  /** Exact, normalised hostname match against active environments only. */
  async resolveStoreEnvironmentByHostname(rawHost: string | undefined | null) {
    const hostname = normalizeHostname(rawHost)
    if (!hostname) {
      return null
    }
    const [env] = await this.listStoreEnvironments({
      hostname,
      status: "active",
    })
    return env ?? null
  }
}

export default TenancyModuleService
