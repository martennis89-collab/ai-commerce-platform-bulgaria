/**
 * Baseline: the same two-merchant fixture and the same attacks against vanilla
 * Medusa 2.21 (no tenancy layer). This records Medusa's actual behaviour so the
 * M0 decision rests on observation, not on documentation or assumptions.
 */
import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createPromotionsWorkflow,
  createRegionsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  createMerchantCommerce,
  createSharedRegion,
  MARIA,
  MerchantCommerceFixture,
  PETYA,
  SHOPPER_EMAIL,
} from "../fixtures/commerce"
import { bearer, call, checkout, createUserWithToken, prepareCart, storefront } from "../fixtures/http"

jest.setTimeout(10 * 60 * 1000)

const observations: Record<string, unknown> = {}
const OUT = path.resolve(
  __dirname,
  "../../../../../.claude/mission-state/m0-medusa-tenancy/baseline-observations.json"
)

medusaIntegrationTestRunner({
  cwd: path.resolve(__dirname, "../baseline-app"),
  testSuite: ({ api, getContainer }) => {
    let regionId: string
    let maria: MerchantCommerceFixture
    let petya: MerchantCommerceFixture
    let adminToken: string
    let mariaOrder: Awaited<ReturnType<typeof checkout>>
    let petyaOrder: Awaited<ReturnType<typeof checkout>>
    let petyaOpen: Awaited<ReturnType<typeof prepareCart>>
    const sfA = () => storefront(maria.publishableKey)
    const record = (id: string, value: unknown) => {
      observations[id] = value
    }
    const summary = (r: { status: number; data: any }) => ({
      status: r.status,
      message: r.data?.message,
      type: r.data?.type,
    })

    beforeAll(async () => {
      const container = getContainer()
      regionId = (await createSharedRegion(container)).id
      maria = await createMerchantCommerce(container, MARIA)
      petya = await createMerchantCommerce(container, PETYA)
      adminToken = (await createUserWithToken(container, api, "any-admin@example.com")).token
      mariaOrder = await checkout(api, maria, regionId, SHOPPER_EMAIL)
      petyaOrder = await checkout(api, petya, regionId, SHOPPER_EMAIL)
      petyaOpen = await prepareCart(api, petya, regionId, SHOPPER_EMAIL)
    })

    afterAll(() => {
      fs.writeFileSync(OUT, JSON.stringify({ medusa: "2.21.0", observations }, null, 2))
    })

    it("NB01/NB02 catalogue: sales-channel filtering hides B's product from A's key", async () => {
      const byId = await call(api.get(`/store/products/${petya.productId}`, sfA()))
      const list = await api.get("/store/products", sfA())
      record("NB01_store_A_get_B_product_by_id", summary(byId))
      record("NB02_store_A_list_contains_B_product", JSON.stringify(list.data).includes(PETYA.productTitle))
      expect(byId.status).toBe(404)
    })

    it("NB03/NB04/NB05 variant injection and completion across merchants", async () => {
      const a = await prepareCart(api, maria, regionId, SHOPPER_EMAIL)
      const managed = await call(
        api.post(`/store/carts/${a.cartId}/line-items`, { variant_id: petya.variantId, quantity: 1 }, sfA())
      )
      record("NB03_add_B_variant_managed_inventory_to_A_cart", summary(managed))

      await updateProductVariantsWorkflow(getContainer()).run({
        input: { selector: { id: petya.variantId }, update: { manage_inventory: false } },
      })
      const unmanaged = await call(
        api.post(`/store/carts/${a.cartId}/line-items`, { variant_id: petya.variantId, quantity: 1 }, sfA())
      )
      record("NB04_add_B_variant_unmanaged_inventory_to_A_cart", summary(unmanaged))

      // Adding items refreshes the payment collection; start a new COD session before completing.
      await api.post(
        `/store/payment-collections/${a.paymentCollectionId}/payment-sessions`,
        { provider_id: "pp_system_default" },
        sfA()
      )
      const complete = await call(api.post(`/store/carts/${a.cartId}/complete`, {}, sfA()))
      const order = complete.data?.order
      record("NB05_complete_A_cart_containing_B_variant", {
        ...summary(complete),
        order_sales_channel_is_A: order ? order.sales_channel_id === maria.salesChannelId : null,
        order_contains_B_item: order ? JSON.stringify(order.items).includes(PETYA.variantTitle) : null,
      })
    })

    it("NB06/NB07/NB13 orders and carts are addressable by id through another merchant's key", async () => {
      const order = await call(api.get(`/store/orders/${petyaOrder.orderId}`, sfA()))
      record("NB06_store_A_key_reads_B_order", {
        ...summary(order),
        leaked_B_item: JSON.stringify(order.data).includes(PETYA.variantTitle),
      })
      const cartRead = await call(api.get(`/store/carts/${petyaOpen.cartId}`, sfA()))
      record("NB13_store_A_key_reads_B_open_cart", summary(cartRead))
      const mutate = await call(
        api.post(`/store/carts/${petyaOpen.cartId}/line-items`, { variant_id: petya.variantId, quantity: 1 }, sfA())
      )
      record("NB07_store_A_key_mutates_B_cart", summary(mutate))
    })

    it("NB08/NB09/NB10 cart re-homing, foreign promotion, foreign shipping option", async () => {
      const a = await prepareCart(api, maria, regionId, SHOPPER_EMAIL)
      const sc = await call(api.post(`/store/carts/${a.cartId}`, { sales_channel_id: petya.salesChannelId }, sfA()))
      record("NB08_move_A_cart_to_B_sales_channel", {
        ...summary(sc),
        resulting_sales_channel_is_B: sc.data?.cart?.sales_channel_id === petya.salesChannelId,
      })
      const b = await prepareCart(api, maria, regionId, SHOPPER_EMAIL)
      const promo = await call(api.post(`/store/carts/${b.cartId}/promotions`, { promo_codes: [PETYA.promoCode] }, sfA()))
      record("NB09_apply_B_promo_code_to_A_cart", {
        ...summary(promo),
        applied: JSON.stringify(promo.data?.cart?.promotions ?? []).includes(PETYA.promoCode),
      })
      const ship = await call(
        api.post(`/store/carts/${b.cartId}/shipping-methods`, { option_id: petya.shippingOptionId }, sfA())
      )
      record("NB10_attach_B_shipping_option_to_A_cart", summary(ship))
    })

    it("NB11/NB12 guest customer is global; admin API has no tenant concept", async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "customer_id"],
        filters: { id: [mariaOrder.orderId, petyaOrder.orderId] },
      })
      const customerIds = [...new Set(orders.map((o: any) => o.customer_id))]
      const customers = await getContainer().resolve(Modules.CUSTOMER).listCustomers({ email: SHOPPER_EMAIL })
      record("NB11_same_email_single_global_customer", {
        distinct_customer_ids_on_orders: customerIds.length,
        customer_rows_for_email: customers.length,
      })
      const adminOrders = await call(api.get(`/admin/orders?fields=id,email,sales_channel_id`, bearer(adminToken)))
      record("NB12_any_admin_user_lists_both_merchants_orders", {
        status: adminOrders.status,
        count: adminOrders.data?.orders?.length,
      })
      expect(customerIds.length).toBe(1)
    })

    it("NB14/NB15 global namespaces: promotion codes and region countries", async () => {
      const container = getContainer()
      const dupPromo = await createPromotionsWorkflow(container)
        .run({
          input: {
            promotionsData: [
              {
                code: PETYA.promoCode,
                type: "standard",
                status: "active",
                application_method: { type: "percentage", target_type: "order", allocation: "across", value: 5, currency_code: "eur" },
              } as any,
            ],
          },
        })
        .then(() => "created")
        .catch((e) => `rejected: ${e.message}`)
      record("NB14_second_merchant_reuses_promo_code", dupPromo)
      const dupRegion = await createRegionsWorkflow(container)
        .run({ input: { regions: [{ name: "Bulgaria (second merchant)", currency_code: "eur", countries: ["bg"] }] } })
        .then(() => "created")
        .catch((e) => `rejected: ${e.message}`)
      record("NB15_second_region_with_country_bg", dupRegion)
    })
  },
})
