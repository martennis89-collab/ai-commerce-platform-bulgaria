/**
 * Trusted platform flow: create a merchant StoreEnvironment, its Medusa
 * commerce bindings, its independent StorefrontProject and a queued preview
 * deployment. Every step compensates, so a failure leaves nothing behind.
 */
import {
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  emitEventStep,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { STOREFRONT_CORE_VERSION } from "@platform/storefront-core"
import { defaultStorefrontConfig } from "@platform/storefront-schema"
import { STOREFRONT_MODULE } from "../../modules/storefront"
import type StorefrontModuleService from "../../modules/storefront/service"
import { TENANCY_MODULE } from "../../modules/tenancy"
import type { OwnedResourceType } from "../../modules/tenancy/models"
import type TenancyModuleService from "../../modules/tenancy/service"
import { STOREFRONT_DEPLOYMENT_QUEUED } from "../../storefront/deployments"
import { assertValidHandle, deployProviderName, hostnamesForHandle } from "../../storefront/platform-config"
import { provisioningScope } from "../../tenancy/context"

export type CreateStoreEnvironmentInput = {
  handle: string
  name: string
  organization_name?: string
  owner_user_id?: string
}

type Validated = {
  handle: string
  name: string
  organization_name: string
  owner_user_id?: string
  live_hostname: string
  preview_hostname: string
  provider: string
}

const validateInputStep = createStep(
  "platform-validate-store-environment-input",
  async (input: CreateStoreEnvironmentInput, { container }) => {
    const handle = assertValidHandle(input?.handle)
    const name = typeof input?.name === "string" ? input.name.trim() : ""
    if (!name || name.length > 80) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Store name must be 1-80 characters")
    }
    const { live, preview } = hostnamesForHandle(handle)
    const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
    const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
    const [existingEnv] = await tenancy.listStoreEnvironments({ handle })
    const [existingProject] = await storefront.listStorefrontProjects({ handle })
    if (existingEnv || existingProject) {
      throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "Store handle is already taken")
    }
    if (input.owner_user_id !== undefined) {
      const [user] = await container.resolve(Modules.USER).listUsers({ id: input.owner_user_id })
      if (!user) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Owner user not found")
      }
    }
    const validated: Validated = {
      handle,
      name,
      organization_name: input.organization_name?.trim() || name,
      owner_user_id: input.owner_user_id,
      live_hostname: live,
      preview_hostname: preview,
      provider: deployProviderName(),
    }
    return new StepResponse(validated)
  }
)

const createEnvironmentStep = createStep(
  "platform-create-store-environment-record",
  async (v: Validated, { container }) => {
    const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
    const organization = await tenancy.createOrganizations({ name: v.organization_name })
    const env = await tenancy.createStoreEnvironments({
      organization_id: organization.id,
      handle: v.handle,
      name: v.name,
      hostname: v.live_hostname,
    })
    return new StepResponse(env, { envId: env.id, organizationId: organization.id })
  },
  async (comp, { container }) => {
    if (!comp) {
      return
    }
    const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
    await tenancy.deleteStoreEnvironments(comp.envId)
    await tenancy.deleteOrganizations(comp.organizationId)
  }
)

/**
 * Medusa's own createApiKeysStep compensates with deleteApiKeys, which the API
 * key module refuses for unrevoked keys — so a rolled-back publishable key would
 * survive. This step revokes before deleting.
 */
const createPublishableKeyStep = createStep(
  "platform-create-storefront-publishable-key",
  async (v: Validated, { container }) => {
    const apiKeys = container.resolve(Modules.API_KEY)
    const [key] = await apiKeys.createApiKeys([
      { title: `${v.name} storefront key`, type: "publishable", created_by: "" },
    ])
    return new StepResponse(key, key.id)
  },
  async (keyId, { container }) => {
    if (!keyId) {
      return
    }
    const apiKeys = container.resolve(Modules.API_KEY)
    await apiKeys.revoke({ id: keyId }, { revoked_by: "platform-compensation", revoke_in: 0 } as any)
    await apiKeys.deleteApiKeys([keyId])
  }
)

const claimResourcesStep = createStep(
  "platform-claim-store-environment-resources",
  async (input: { envId: string; resources: Partial<Record<OwnedResourceType, string[]>> }, { container }) => {
    const scope = provisioningScope(container, input.envId)
    const claimed: Partial<Record<OwnedResourceType, string[]>> = {}
    for (const [type, ids] of Object.entries(input.resources)) {
      claimed[type as OwnedResourceType] = await scope.claim(type as OwnedResourceType, ids ?? [])
    }
    return new StepResponse(claimed, claimed)
  },
  async (claimed, { container }) => {
    if (!claimed) {
      return
    }
    const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
    for (const [type, ids] of Object.entries(claimed)) {
      await tenancy.releaseResources(type as OwnedResourceType, ids ?? [])
    }
  }
)

const createProjectStep = createStep(
  "platform-create-storefront-project",
  async (input: { v: Validated; envId: string; publishableKeyId: string }, { container }) => {
    const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
    const project = await storefront.createStorefrontProjects({
      store_environment_id: input.envId,
      handle: input.v.handle,
      core_version: STOREFRONT_CORE_VERSION,
      deployment_provider: input.v.provider,
      repository_ref: `${input.v.provider}:projects/${input.v.handle}`,
      publishable_api_key_id: input.publishableKeyId,
      preview_hostname: input.v.preview_hostname,
      live_hostname: input.v.live_hostname,
      config: defaultStorefrontConfig(input.v.name),
    } as any)
    return new StepResponse(project as any, (project as any).id)
  },
  async (projectId, { container }) => {
    if (projectId) {
      const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
      await storefront.deleteStorefrontProjects(projectId)
    }
  }
)

const addOwnerMembershipStep = createStep(
  "platform-add-store-environment-owner",
  async (input: { envId: string; userId: string }, { container }) => {
    const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
    // The unique index on user_id is the authority (M0: one environment per user).
    const member = await tenancy.createStoreEnvironmentMembers({
      store_environment_id: input.envId,
      user_id: input.userId,
      role: "owner",
    })
    return new StepResponse(member, member.id)
  },
  async (memberId, { container }) => {
    if (memberId) {
      const tenancy: TenancyModuleService = container.resolve(TENANCY_MODULE)
      await tenancy.deleteStoreEnvironmentMembers(memberId)
    }
  }
)

const createPreviewDeploymentRecordStep = createStep(
  "platform-create-preview-deployment-record",
  async (project: any, { container }) => {
    const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
    const deployment = await storefront.createDeployments({
      project_id: project.id,
      store_environment_id: project.store_environment_id,
      target: "preview",
      status: "queued",
      provider: project.deployment_provider,
      core_version: project.core_version,
      hostname: project.preview_hostname,
    } as any)
    return new StepResponse(deployment as any, (deployment as any).id)
  },
  async (deploymentId, { container }) => {
    if (deploymentId) {
      const storefront: StorefrontModuleService = container.resolve(STOREFRONT_MODULE)
      await storefront.deleteDeployments(deploymentId)
    }
  }
)

export const createStoreEnvironmentWorkflow = createWorkflow(
  "platform-create-store-environment",
  (input: WorkflowData<CreateStoreEnvironmentInput>) => {
    const v = validateInputStep(input)
    const env = createEnvironmentStep(v)

    const salesChannels = createSalesChannelsWorkflow.runAsStep({
      input: transform({ v }, ({ v }) => ({ salesChannelsData: [{ name: `${v.name} Storefront` }] })),
    })
    const apiKey = createPublishableKeyStep(v)
    linkSalesChannelsToApiKeyWorkflow.runAsStep({
      input: transform({ apiKey, salesChannels }, ({ apiKey, salesChannels }) => ({
        id: apiKey.id,
        add: [salesChannels[0].id],
      })),
    })
    const locations = createStockLocationsWorkflow.runAsStep({
      input: transform({ v }, ({ v }) => ({ locations: [{ name: `${v.name} Warehouse` }] })),
    })
    linkSalesChannelsToStockLocationWorkflow.runAsStep({
      input: transform({ locations, salesChannels }, ({ locations, salesChannels }) => ({
        id: locations[0].id,
        add: [salesChannels[0].id],
      })),
    })

    claimResourcesStep(
      transform({ env, salesChannels, apiKey, locations }, ({ env, salesChannels, apiKey, locations }) => ({
        envId: env.id,
        resources: {
          sales_channel: [salesChannels[0].id],
          api_key: [apiKey.id],
          stock_location: [locations[0].id],
        },
      }))
    )

    const project = createProjectStep(
      transform({ v, env, apiKey }, ({ v, env, apiKey }) => ({
        v,
        envId: env.id,
        publishableKeyId: apiKey.id,
      }))
    )

    when({ v }, ({ v }) => !!v.owner_user_id).then(() => {
      addOwnerMembershipStep(
        transform({ v, env }, ({ v, env }) => ({ envId: env.id, userId: v.owner_user_id as string }))
      )
    })

    const deployment = createPreviewDeploymentRecordStep(project)
    emitEventStep({
      eventName: STOREFRONT_DEPLOYMENT_QUEUED,
      data: transform({ deployment }, ({ deployment }) => ({ id: deployment.id })),
    })

    return new WorkflowResponse({ store_environment: env, project, deployment })
  }
)
