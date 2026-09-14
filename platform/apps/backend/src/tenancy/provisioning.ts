/**
 * Trusted platform provisioning (not reachable from any HTTP input in M0).
 * M1 will call these from the StoreEnvironment creation flow.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { TENANCY_MODULE } from "../modules/tenancy"
import type { OwnedResourceType } from "../modules/tenancy/models"
import type TenancyModuleService from "../modules/tenancy/service"
import { provisioningScope } from "./context"
import { normalizeHostname } from "./hostname"

export async function provisionStoreEnvironment(
  container: MedusaContainer,
  input: { organizationName: string; handle: string; name: string; hostname: string }
) {
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  const hostname = normalizeHostname(input.hostname)
  if (!hostname) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid hostname")
  }
  const organization = await tenancy.createOrganizations({ name: input.organizationName })
  return tenancy.createStoreEnvironments({
    organization_id: organization.id,
    handle: input.handle,
    name: input.name,
    hostname,
  })
}

export async function assignResourcesToEnvironment(
  container: MedusaContainer,
  storeEnvironmentId: string,
  resources: Partial<Record<OwnedResourceType, string[]>>
) {
  const scope = provisioningScope(container, storeEnvironmentId)
  for (const [type, ids] of Object.entries(resources)) {
    await scope.claim(type as OwnedResourceType, ids ?? [])
  }
}

export async function addMerchantMember(
  container: MedusaContainer,
  storeEnvironmentId: string,
  userId: string,
  role: "owner" | "staff" = "owner"
) {
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  return tenancy.createStoreEnvironmentMembers({
    store_environment_id: storeEnvironmentId,
    user_id: userId,
    role,
  })
}

export async function registerPlatformOperator(container: MedusaContainer, userId: string) {
  const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
  return tenancy.createPlatformOperators({ user_id: userId })
}
