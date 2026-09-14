/**
 * Vanilla Medusa commerce fixture for one merchant. Deliberately imports nothing
 * from the tenancy layer so the same fixture drives both the protected suite
 * and the unprotected Medusa baseline suite.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createLocationFulfillmentSetWorkflow,
  createProductsWorkflow,
  createPromotionsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

export type MerchantSpec = {
  key: "maria" | "petya"
  storeName: string
  hostname: string
  productTitle: string
  variantTitle: string
  sku: string
  price: number
  promoCode: string
}

export const MARIA: MerchantSpec = {
  key: "maria",
  storeName: "Maria Candles",
  hostname: "maria-candles.shops.test",
  productTitle: "Maria Vanilla Candle",
  variantTitle: "Maria Vanilla Candle 200g",
  sku: "MARIA-VANILLA-200",
  price: 18,
  promoCode: "MARIA10",
}

export const PETYA: MerchantSpec = {
  key: "petya",
  storeName: "Petya Jewellery",
  hostname: "petya-jewellery.shops.test",
  productTitle: "Petya Silver Bracelet",
  variantTitle: "Petya Silver Bracelet S",
  sku: "PETYA-SILVER-S",
  price: 65,
  promoCode: "PETYA10",
}

export const SHOPPER_EMAIL = "test@example.com"

export type MerchantCommerceFixture = {
  spec: MerchantSpec
  salesChannelId: string
  apiKeyId: string
  publishableKey: string
  stockLocationId: string
  shippingProfileId: string
  serviceZoneId: string
  shippingOptionId: string
  productId: string
  variantId: string
  inventoryItemId: string
  promotionId: string
}

/** BG/EUR region. Medusa allows a country in only one region, so it is platform-shared. */
export async function createSharedRegion(container: MedusaContainer) {
  const { result } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Bulgaria",
          currency_code: "eur",
          countries: ["bg"],
          payment_providers: ["pp_system_default"],
          automatic_taxes: false,
        },
      ],
    },
  })
  return result[0]
}

export async function createMerchantCommerce(
  container: MedusaContainer,
  spec: MerchantSpec
): Promise<MerchantCommerceFixture> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const {
    result: [salesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: `${spec.storeName} Storefront` }] },
  })

  const {
    result: [apiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [{ title: `${spec.storeName} storefront key`, type: "publishable", created_by: "" }],
    },
  })
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: apiKey.id, add: [salesChannel.id] },
  })

  const {
    result: [location],
  } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: `${spec.storeName} Warehouse`,
          address: { address_1: `${spec.storeName} workshop`, city: "Sofia", country_code: "BG" },
        },
      ],
    },
  })
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: location.id, add: [salesChannel.id] },
  })
  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  })

  const {
    result: [shippingProfile],
  } = await createShippingProfilesWorkflow(container).run({
    input: { data: [{ name: `${spec.storeName} parcels`, type: "default" }] },
  })

  await createLocationFulfillmentSetWorkflow(container).run({
    input: {
      location_id: location.id,
      fulfillment_set_data: { name: `${spec.storeName} delivery`, type: "shipping" },
    },
  })
  const {
    data: [locationWithSets],
  } = await query.graph({
    entity: "stock_location",
    fields: ["id", "fulfillment_sets.id"],
    filters: { id: location.id },
  })
  const fulfillmentSetId = (locationWithSets as any).fulfillment_sets[0].id

  const {
    result: [serviceZone],
  } = await createServiceZonesWorkflow(container).run({
    input: {
      data: [
        {
          name: `${spec.storeName} Bulgaria`,
          fulfillment_set_id: fulfillmentSetId,
          geo_zones: [{ type: "country", country_code: "bg" }],
        },
      ],
    },
  })

  const {
    result: [shippingOption],
  } = await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: `${spec.storeName} courier`,
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: serviceZone.id,
        shipping_profile_id: shippingProfile.id,
        type: { label: "Standard", description: "2-3 days", code: `${spec.key}-standard` },
        prices: [{ currency_code: "eur", amount: 5 }],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  })

  const {
    result: [product],
  } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: spec.productTitle,
          handle: `${spec.key}-product`,
          status: "published",
          shipping_profile_id: shippingProfile.id,
          images: [{ url: `https://media.shops.test/${spec.key}/product.jpg` }],
          options: [{ title: "Size", values: ["Standard"] }],
          variants: [
            {
              title: spec.variantTitle,
              sku: spec.sku,
              manage_inventory: true,
              options: { Size: "Standard" },
              prices: [{ amount: spec.price, currency_code: "eur" }],
            },
          ],
          sales_channels: [{ id: salesChannel.id }],
        },
      ],
    },
  })

  const {
    data: [variant],
  } = await query.graph({
    entity: "product_variant",
    fields: ["id", "inventory_items.inventory_item_id"],
    filters: { product_id: product.id },
  })
  const inventoryItemId = (variant as any).inventory_items[0].inventory_item_id

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        { inventory_item_id: inventoryItemId, location_id: location.id, stocked_quantity: 100 },
      ],
    },
  })

  const {
    result: [promotion],
  } = await createPromotionsWorkflow(container).run({
    input: {
      promotionsData: [
        {
          code: spec.promoCode,
          type: "standard",
          status: "active",
          application_method: {
            type: "percentage",
            target_type: "order",
            allocation: "across",
            value: 10,
            currency_code: "eur",
          },
        } as any,
      ],
    },
  })

  return {
    spec,
    salesChannelId: salesChannel.id,
    apiKeyId: apiKey.id,
    publishableKey: apiKey.token,
    stockLocationId: location.id,
    shippingProfileId: shippingProfile.id,
    serviceZoneId: serviceZone.id,
    shippingOptionId: shippingOption.id,
    productId: product.id,
    variantId: (variant as any).id,
    inventoryItemId,
    promotionId: promotion.id,
  }
}
