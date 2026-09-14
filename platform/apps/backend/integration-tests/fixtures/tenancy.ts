import type { MedusaContainer } from "@medusajs/framework/types"
import {
  addMerchantMember,
  assignResourcesToEnvironment,
  provisionStoreEnvironment,
} from "../../src/tenancy/provisioning"
import type { MerchantCommerceFixture } from "./commerce"
import { createUserWithToken } from "./http"

export type TenantFixture = MerchantCommerceFixture & {
  envId: string
  userId: string
  token: string
}

/** Platform provisioning: StoreEnvironment + ownership of every commerce resource + owner user. */
export async function provisionTenant(
  container: MedusaContainer,
  api: any,
  commerce: MerchantCommerceFixture
): Promise<TenantFixture> {
  const { spec } = commerce
  const env = await provisionStoreEnvironment(container, {
    organizationName: `${spec.storeName} EOOD`,
    handle: spec.key,
    name: spec.storeName,
    hostname: spec.hostname,
  })
  await assignResourcesToEnvironment(container, env.id, {
    sales_channel: [commerce.salesChannelId],
    api_key: [commerce.apiKeyId],
    stock_location: [commerce.stockLocationId],
    shipping_profile: [commerce.shippingProfileId],
    shipping_option: [commerce.shippingOptionId],
    product: [commerce.productId],
    inventory_item: [commerce.inventoryItemId],
    promotion: [commerce.promotionId],
  })
  const { user, token } = await createUserWithToken(container, api, `owner@${spec.key}.test`)
  await addMerchantMember(container, env.id, user.id, "owner")
  return { ...commerce, envId: env.id, userId: user.id, token }
}
