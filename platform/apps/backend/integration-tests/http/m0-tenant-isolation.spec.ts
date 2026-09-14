/**
 * M0 — adversarial two-tenant isolation suite.
 *
 * Every attack deliberately uses real ids that belong to the other tenant.
 * Test ids (T01…) map to .claude/mission-state/m0-medusa-tenancy/TESTS.json.
 */
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, FeatureFlag, Modules } from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflowId,
  addToCartWorkflowId,
  createApiKeysWorkflow,
  createProductsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  updateCartPromotionsWorkflowId,
  updateCartWorkflowId,
} from "@medusajs/medusa/core-flows"
import {
  createMerchantCommerce,
  createSharedRegion,
  MARIA,
  PETYA,
  SHOPPER_EMAIL,
} from "../fixtures/commerce"
import {
  bearer,
  call,
  checkout,
  createUserWithToken,
  forgeJwt,
  prepareCart,
  storefront,
} from "../fixtures/http"
import { provisionTenant, TenantFixture } from "../fixtures/tenancy"
import { registerPlatformOperator } from "../../src/tenancy/provisioning"
import { buildMerchantExecutionContext } from "../../src/tenancy/context"
import { executeTenantTool, MERCHANT_TOOLS } from "../../src/tenancy/tools"
import { TENANCY_MODULE } from "../../src/modules/tenancy"

jest.setTimeout(10 * 60 * 1000)

const ISOLATION_VIOLATION = /Tenant isolation violation/

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let regionId: string
    let maria: TenantFixture
    let petya: TenantFixture
    let operatorToken: string
    let mariaOrder: Awaited<ReturnType<typeof checkout>>
    let petyaOrder: Awaited<ReturnType<typeof checkout>>
    let mariaOpen: Awaited<ReturnType<typeof prepareCart>>
    let petyaOpen: Awaited<ReturnType<typeof prepareCart>>

    const tenancy = () => getContainer().resolve(TENANCY_MODULE) as any
    const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
    const sfA = () => storefront(maria.publishableKey)
    const sfB = () => storefront(petya.publishableKey)
    const merchantA = () => bearer(maria.token)
    const shopperOf = async (envId: string) =>
      (await tenancy().listShoppers({ store_environment_id: envId })) as any[]

    /**
     * Runs a workflow the way application code does (through the workflow engine
     * by id), so hooks registered by the app apply. Importing a workflow into the
     * Jest test module and calling `.run()` uses a separate, hook-less module instance.
     */
    const runWorkflowExpectingViolation = async (workflowId: string, input: Record<string, unknown>) => {
      const engine = getContainer().resolve(Modules.WORKFLOW_ENGINE)
      const { errors } = await engine.run(workflowId, { input, throwOnError: false })
      expect(errors?.[0]?.error?.message).toMatch(ISOLATION_VIOLATION)
    }

    beforeAll(async () => {
      const container = getContainer()
      regionId = (await createSharedRegion(container)).id
      maria = await provisionTenant(container, api, await createMerchantCommerce(container, MARIA))
      petya = await provisionTenant(container, api, await createMerchantCommerce(container, PETYA))
      const operator = await createUserWithToken(container, api, "operator@platform.test")
      await registerPlatformOperator(container, operator.user.id)
      operatorToken = operator.token

      // The same shopper identity buys independently from both merchants.
      mariaOrder = await checkout(api, maria, regionId, SHOPPER_EMAIL)
      petyaOrder = await checkout(api, petya, regionId, SHOPPER_EMAIL)
      mariaOpen = await prepareCart(api, maria, regionId, SHOPPER_EMAIL)
      petyaOpen = await prepareCart(api, petya, regionId, SHOPPER_EMAIL)
    })

    // ------------------------------------------------------------------ baseline
    describe("normal operation", () => {
      it("T01 both stores operate: catalogue, cart, checkout, owned order, merchant order view", async () => {
        for (const [t, order, name] of [
          [maria, mariaOrder, MARIA.productTitle],
          [petya, petyaOrder, PETYA.productTitle],
        ] as const) {
          const products = await api.get("/store/products", storefront(t.publishableKey))
          expect(products.data.products.map((p: any) => p.title)).toEqual([name])
          expect(order.order.email).toBe(SHOPPER_EMAIL)
          const owners = await tenancy().getOwners("order", [order.orderId])
          expect(owners.get(order.orderId)).toBe(t.envId)
          const orders = await api.get("/merchant/orders", bearer(t.token))
          expect(orders.data.orders.map((o: any) => o.id)).toEqual([order.orderId])
        }
      })

      it("T02 same email buys at both stores; each merchant gets its own Shopper and metrics", async () => {
        const [a] = await shopperOf(maria.envId)
        const [b] = await shopperOf(petya.envId)
        expect(a.email).toBe(SHOPPER_EMAIL)
        expect(b.email).toBe(SHOPPER_EMAIL)
        expect(a.id).not.toBe(b.id)

        const { data } = await api.get("/merchant/shoppers", merchantA())
        expect(data.shoppers).toHaveLength(1)
        expect(data.shoppers[0]).toMatchObject({
          email: SHOPPER_EMAIL,
          order_count: 1,
          order_ids: [mariaOrder.orderId],
        })
        expect(data.shoppers[0].lifetime_value).toBe(Number(mariaOrder.order.total))
        const petyaView = await api.get("/merchant/shoppers", bearer(petya.token))
        expect(petyaView.data.shoppers[0].lifetime_value).toBe(Number(petyaOrder.order.total))

        // Discovery: Medusa itself links both guest orders to ONE global customer row.
        const { data: orders } = await query().graph({
          entity: "order",
          fields: ["id", "customer_id"],
          filters: { id: [mariaOrder.orderId, petyaOrder.orderId] },
        })
        expect(new Set(orders.map((o: any) => o.customer_id)).size).toBe(1)
        expect(JSON.stringify(data)).not.toContain(orders[0].customer_id)
      })
    })

    // ---------------------------------------------------------------- catalogue
    describe("catalogue isolation", () => {
      it("T03 Store A catalogue never contains Store B products or media", async () => {
        const res = await api.get("/store/products?fields=*images,*variants", sfA())
        const body = JSON.stringify(res.data)
        expect(body).toContain(MARIA.productTitle)
        expect(body).not.toContain(PETYA.productTitle)
        expect(body).not.toContain("media.shops.test/petya")
        expect(body).not.toContain(petya.variantId)
      })

      it("T04 Store B product by known id through Store A context is not found", async () => {
        expect((await call(api.get(`/store/products/${petya.productId}`, sfA()))).status).toBe(404)
      })

      it("T05 filter tricks cannot widen Store A's catalogue", async () => {
        const byId = await api.get(`/store/products?id[]=${petya.productId}`, sfA())
        expect(byId.data.products).toEqual([])
        const byHandle = await api.get(`/store/products?handle=petya-product`, sfA())
        expect(byHandle.data.products).toEqual([])
        const bySc = await call(api.get(`/store/products?sales_channel_id[]=${petya.salesChannelId}`, sfA()))
        expect(JSON.stringify(bySc.data)).not.toContain(PETYA.productTitle)
      })

      it("T06 unclassified catalogue routes are denied by default", async () => {
        for (const path of [
          `/store/product-variants/${petya.variantId}`,
          `/store/product-variants`,
          `/store/collections`,
          `/store/product-categories`,
        ]) {
          expect({ path, status: (await call(api.get(path, sfA()))).status }).toEqual({ path, status: 403 })
        }
      })
    })

    // -------------------------------------------------------- variant injection
    describe("variant injection", () => {
      it("T07 adding Store B's variant to a legitimate Store A cart is denied", async () => {
        const { data } = await api.post("/store/carts", { region_id: regionId }, sfA())
        const res = await call(
          api.post(`/store/carts/${data.cart.id}/line-items`, { variant_id: petya.variantId, quantity: 1 }, sfA())
        )
        expect(res.status).toBe(404)
        const cart = await api.get(`/store/carts/${data.cart.id}`, sfA())
        expect(cart.data.cart.items).toEqual([])
      })

      it("T08 creating a Store A cart pre-filled with Store B's variant is denied", async () => {
        const res = await call(
          api.post(
            "/store/carts",
            { region_id: regionId, items: [{ variant_id: petya.variantId, quantity: 1 }] },
            sfA()
          )
        )
        expect(res.status).toBe(404)
      })

      it("T09 workflow-level injection (bypassing HTTP) is rejected by the addToCart hook", async () => {
        await runWorkflowExpectingViolation(addToCartWorkflowId, {
          cart_id: mariaOpen.cartId,
          items: [{ variant_id: petya.variantId, quantity: 1 }],
        })
        const { data } = await query().graph({ entity: "cart", fields: ["items.variant_id"], filters: { id: mariaOpen.cartId } })
        expect(data[0].items.map((i: any) => i.variant_id)).toEqual([maria.variantId])
      })
    })

    // ---------------------------------------------------------- cart completion
    describe("cart completion and cart mutation", () => {
      it("T10 a Store A cart that contains a Store B item (injected below the API) cannot complete", async () => {
        const cartModule = getContainer().resolve(Modules.CART)
        await cartModule.addLineItems({
          cart_id: mariaOpen.cartId,
          variant_id: petya.variantId,
          product_id: petya.productId,
          title: PETYA.variantTitle,
          quantity: 1,
          unit_price: PETYA.price,
        } as any)
        const res = await call(api.post(`/store/carts/${mariaOpen.cartId}/complete`, {}, sfA()))
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(ISOLATION_VIOLATION)
        const { data: link } = await query().graph({
          entity: "order_cart",
          fields: ["order_id"],
          filters: { cart_id: mariaOpen.cartId },
        })
        expect(link).toEqual([])
      })

      it("T11 Store B context cannot complete or read a Store A cart", async () => {
        expect((await call(api.post(`/store/carts/${mariaOpen.cartId}/complete`, {}, sfB()))).status).toBe(404)
        expect((await call(api.get(`/store/carts/${mariaOpen.cartId}`, sfB()))).status).toBe(404)
      })

      it("T12 a Store A cart cannot be moved onto Store B's sales channel", async () => {
        const res = await call(
          api.post(`/store/carts/${mariaOpen.cartId}`, { sales_channel_id: petya.salesChannelId }, sfA())
        )
        expect(res.status).toBe(404)
        await runWorkflowExpectingViolation(updateCartWorkflowId, {
          id: mariaOpen.cartId,
          sales_channel_id: petya.salesChannelId,
        })
        const { data } = await query().graph({ entity: "cart", fields: ["sales_channel_id"], filters: { id: mariaOpen.cartId } })
        expect(data[0].sales_channel_id).toBe(maria.salesChannelId)
      })

      it("T13 Store B's shipping option cannot be attached to a Store A cart", async () => {
        const res = await call(
          api.post(`/store/carts/${mariaOpen.cartId}/shipping-methods`, { option_id: petya.shippingOptionId }, sfA())
        )
        expect(res.status).toBe(404)
        await runWorkflowExpectingViolation(addShippingMethodToCartWorkflowId, {
          cart_id: mariaOpen.cartId,
          options: [{ id: petya.shippingOptionId }],
        })
      })

      it("T14 Store B's promotion code cannot be applied to a Store A cart (own code works)", async () => {
        const res = await call(
          api.post(`/store/carts/${mariaOpen.cartId}/promotions`, { promo_codes: [PETYA.promoCode] }, sfA())
        )
        expect(res.status).toBe(404)
        await runWorkflowExpectingViolation(updateCartPromotionsWorkflowId, {
          cart_id: mariaOpen.cartId,
          promo_codes: [PETYA.promoCode],
          action: "add",
        })
        const own = await call(
          api.post(`/store/carts/${mariaOpen.cartId}/promotions`, { promo_codes: [MARIA.promoCode] }, sfA())
        )
        expect(own.status).toBe(200)
      })

      it("T15 Store B payment collection / cart cannot be driven from Store A", async () => {
        expect(
          (await call(api.post(`/store/payment-collections`, { cart_id: petyaOpen.cartId }, sfA()))).status
        ).toBe(404)
        expect(
          (
            await call(
              api.post(
                `/store/payment-collections/${petyaOpen.paymentCollectionId}/payment-sessions`,
                { provider_id: "pp_system_default" },
                sfA()
              )
            )
          ).status
        ).toBe(404)
      })

      it("T16 a Store B line item cannot be addressed through a Store A cart path", async () => {
        expect(
          (
            await call(
              api.post(`/store/carts/${mariaOpen.cartId}/line-items/${petyaOpen.lineItemId}`, { quantity: 5 }, sfA())
            )
          ).status
        ).toBe(404)
        expect(
          (await call(api.delete(`/store/carts/${mariaOpen.cartId}/line-items/${petyaOpen.lineItemId}`, sfA())))
            .status
        ).toBe(404)
      })
    })

    // ------------------------------------------------------------------- orders
    describe("order isolation and mutation", () => {
      it("T17 merchant A cannot read Store B's order by id; list contains only own orders", async () => {
        expect((await call(api.get(`/merchant/orders/${petyaOrder.orderId}`, merchantA()))).status).toBe(404)
        const { data } = await api.get("/merchant/orders", merchantA())
        expect(data.orders.map((o: any) => o.id)).toEqual([mariaOrder.orderId])
        expect(JSON.stringify(data)).not.toContain(PETYA.variantTitle)
      })

      it("T18 Store A storefront cannot read Store B's order by id", async () => {
        expect((await call(api.get(`/store/orders/${petyaOrder.orderId}`, sfA()))).status).toBe(404)
        expect((await call(api.get(`/store/orders/${mariaOrder.orderId}`, sfA()))).status).toBe(200)
      })

      it("T19 merchants cannot use Medusa's tenant-unaware admin API; operators can", async () => {
        expect((await call(api.get(`/admin/orders/${petyaOrder.orderId}`, merchantA()))).status).toBe(403)
        expect((await call(api.get(`/admin/orders`, merchantA()))).status).toBe(403)
        expect((await call(api.get(`/admin/orders/${petyaOrder.orderId}`, bearer(operatorToken)))).status).toBe(200)
      })

      it("T20 merchant A cannot cancel/complete Store B's order; own cancel works", async () => {
        expect((await call(api.post(`/merchant/orders/${petyaOrder.orderId}/cancel`, {}, merchantA()))).status).toBe(404)
        expect((await call(api.post(`/merchant/orders/${petyaOrder.orderId}/complete`, {}, merchantA()))).status).toBe(404)
        expect(
          (await call(api.post(`/admin/orders/${petyaOrder.orderId}/cancel`, {}, merchantA()))).status
        ).toBe(403)
        const { data } = await query().graph({ entity: "order", fields: ["status"], filters: { id: petyaOrder.orderId } })
        expect(data[0].status).toBe("pending")
        const own = await api.post(`/merchant/orders/${mariaOrder.orderId}/cancel`, {}, merchantA())
        expect(own.data.order.status).toBe("canceled")
      })
    })

    // ---------------------------------------------------------------- inventory
    describe("inventory isolation", () => {
      it("T21 merchant A cannot read or mutate Store B stock (incl. mixed item/location pairs)", async () => {
        const list = await api.get("/merchant/inventory", merchantA())
        expect(list.data.inventory_levels.map((l: any) => l.inventory_item_id)).toEqual([maria.inventoryItemId])

        const pairs = [
          [petya.inventoryItemId, petya.stockLocationId],
          [maria.inventoryItemId, petya.stockLocationId],
          [petya.inventoryItemId, maria.stockLocationId],
        ]
        for (const [item, loc] of pairs) {
          expect((await call(api.get(`/merchant/inventory/${item}/${loc}`, merchantA()))).status).toBe(404)
          expect(
            (await call(api.post(`/merchant/inventory/${item}/${loc}`, { stocked_quantity: 0 }, merchantA()))).status
          ).toBe(404)
        }
        const inventory = getContainer().resolve(Modules.INVENTORY)
        const [level] = await inventory.listInventoryLevels({
          inventory_item_id: petya.inventoryItemId,
          location_id: petya.stockLocationId,
        })
        expect(Number(level.stocked_quantity)).toBe(100)

        const own = await api.post(
          `/merchant/inventory/${maria.inventoryItemId}/${maria.stockLocationId}`,
          { stocked_quantity: 42 },
          merchantA()
        )
        expect(own.data.inventory_level.stocked_quantity).toBe(42)
      })

      it("T22 merchant token cannot reach native admin inventory/stock-location APIs", async () => {
        expect((await call(api.get(`/admin/inventory-items/${petya.inventoryItemId}`, merchantA()))).status).toBe(403)
        expect(
          (
            await call(
              api.post(
                `/admin/inventory-items/${petya.inventoryItemId}/location-levels/${petya.stockLocationId}`,
                { stocked_quantity: 0 },
                merchantA()
              )
            )
          ).status
        ).toBe(403)
      })
    })

    // ----------------------------------------------------------------- products
    describe("product mutation", () => {
      it("T23 merchant A cannot update or archive Store B's product; own update works", async () => {
        expect(
          (await call(api.post(`/merchant/products/${petya.productId}`, { title: "hacked" }, merchantA()))).status
        ).toBe(404)
        expect(
          (await call(api.post(`/merchant/products/${petya.productId}`, { status: "draft" }, merchantA()))).status
        ).toBe(404)
        expect((await call(api.delete(`/merchant/products/${petya.productId}`, merchantA()))).status).toBe(404)
        expect(
          (await call(api.post(`/admin/products/${petya.productId}`, { title: "hacked" }, merchantA()))).status
        ).toBe(403)
        const { data } = await query().graph({
          entity: "product",
          fields: ["title", "status", "deleted_at"],
          filters: { id: petya.productId },
        })
        expect(data[0]).toMatchObject({ title: PETYA.productTitle, status: "published", deleted_at: null })
        const own = await api.post(`/merchant/products/${maria.productId}`, { title: "Maria Vanilla Candle XL" }, merchantA())
        expect(own.data.product.title).toBe("Maria Vanilla Candle XL")
      })
    })

    // ----------------------------------------------------------------- shoppers
    describe("shopper / customer isolation", () => {
      it("T24 Store A exposes no Store B relationship, history, order count or value", async () => {
        const [b] = await shopperOf(petya.envId)
        expect((await call(api.get(`/merchant/shoppers/${b.id}`, merchantA()))).status).toBe(404)
        const { data } = await api.get("/merchant/shoppers", merchantA())
        const body = JSON.stringify(data)
        expect(body).not.toContain(petyaOrder.orderId)
        expect(body).not.toContain(b.id)
        expect(data.shoppers[0].order_count).toBe(1)

        const customerId = (mariaOrder.order as any).customer_id
        expect((await call(api.get(`/admin/customers/${customerId}`, merchantA()))).status).toBe(403)
        expect((await call(api.get(`/store/customers/me`, sfA()))).status).toBe(403)
        expect((await call(api.get(`/store/orders`, sfA()))).status).toBe(403)
        expect(
          (await call(api.post(`/auth/customer/emailpass/register`, { email: SHOPPER_EMAIL, password: "x" }))).status
        ).toBe(403)
      })

      it("RT01 storefront order field expansion does not expose Medusa's global customer id", async () => {
        const { data: orders } = await query().graph({
          entity: "order",
          fields: ["id", "customer_id"],
          filters: { id: [mariaOrder.orderId, petyaOrder.orderId] },
        })
        const globalCustomerId = orders[0].customer_id
        expect(globalCustomerId).toBeTruthy()

        const res = await call(
          api.get(
            `/store/orders/${mariaOrder.orderId}?fields=%2Bcustomer_id,%2Bcustomer.id,%2Bcustomer.email`,
            sfA()
          )
        )
        expect(res.status).toBe(400)
        const body = JSON.stringify(res.data)
        expect(body).not.toContain(globalCustomerId)
        expect(body).toContain("Medusa customer fields are platform-internal")
      })

      it("RT02 storefront cart field expansion cannot expose Medusa's global customer relation", async () => {
        const { data: orders } = await query().graph({
          entity: "order",
          fields: ["id", "customer_id"],
          filters: { id: [mariaOrder.orderId, petyaOrder.orderId] },
        })
        const globalCustomerId = orders[0].customer_id

        const normal = await api.get(`/store/carts/${mariaOpen.cartId}`, sfA())
        expect(JSON.stringify(normal.data)).not.toContain(globalCustomerId)
        expect(normal.data.cart.customer).toBeUndefined()
        expect(normal.data.cart.customer_id).toBeUndefined()

        const res = await call(
          api.get(`/store/carts/${mariaOpen.cartId}?fields=%2Bcustomer,%2Bcustomer.id`, sfA())
        )
        expect(res.status).toBe(400)
        expect(JSON.stringify(res.data)).toContain("Medusa customer fields are platform-internal")
      })

      const globalCustomerIdOf = async (orderId: string) => {
        const { data } = await query().graph({ entity: "order", fields: ["customer_id"], filters: { id: orderId } })
        const id = data[0].customer_id as string
        expect(id).toMatch(/^cus_/)
        return id
      }

      it("RT03 no default storefront response on any cart/order route carries the global customer id", async () => {
        const globalCustomerId = await globalCustomerIdOf(mariaOrder.orderId)
        const h = sfA()
        const leaks: string[] = []
        const probe = (name: string, res: { status: number; data: any }) => {
          const body = JSON.stringify(res.data ?? "")
          if (body.includes(globalCustomerId) || /"customer"\s*:\s*\{/.test(body)) {
            leaks.push(`${name} (${res.status})`)
          }
          return res
        }

        const created = probe("POST /store/carts", await call(api.post("/store/carts", { region_id: regionId, email: SHOPPER_EMAIL }, h)))
        const cartId = created.data.cart.id
        const added = probe(
          "POST line-items",
          await call(api.post(`/store/carts/${cartId}/line-items`, { variant_id: maria.variantId, quantity: 2 }, h))
        )
        const lineId = added.data.cart.items[0].id
        probe("POST line-items/:line_id", await call(api.post(`/store/carts/${cartId}/line-items/${lineId}`, { quantity: 1 }, h)))
        probe(
          "POST /store/carts/:id",
          await call(api.post(`/store/carts/${cartId}`, { shipping_address: { first_name: "T", last_name: "S", address_1: "a", city: "Sofia", country_code: "bg", postal_code: "1000" } }, h))
        )
        probe("GET /store/carts/:id", await call(api.get(`/store/carts/${cartId}`, h)))
        probe("POST promotions", await call(api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [MARIA.promoCode] }, h)))
        probe("DELETE promotions", await call(api.delete(`/store/carts/${cartId}/promotions`, { ...h, data: { promo_codes: [MARIA.promoCode] } })))
        const options = probe("GET shipping-options", await call(api.get(`/store/shipping-options?cart_id=${cartId}`, h)))
        probe(
          "POST shipping-methods",
          await call(api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: options.data.shipping_options[0].id }, h))
        )
        const pc = probe("POST payment-collections", await call(api.post(`/store/payment-collections`, { cart_id: cartId }, h)))
        probe(
          "POST payment-sessions",
          await call(api.post(`/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, h))
        )
        const extra = await api.post(`/store/carts/${cartId}/line-items`, { variant_id: maria.variantId, quantity: 1 }, h)
        const extraLine = extra.data.cart.items.find((i: any) => i.id !== lineId)?.id ?? extra.data.cart.items[0].id
        probe("DELETE line-items/:line_id", await call(api.delete(`/store/carts/${cartId}/line-items/${extraLine}`, h)))
        await api.post(`/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, h)
        const completed = probe("POST complete", await call(api.post(`/store/carts/${cartId}/complete`, {}, h)))
        probe("GET /store/orders/:id", await call(api.get(`/store/orders/${completed.data.order?.id ?? mariaOrder.orderId}`, h)))

        expect(leaks).toEqual([])
      })

      it("RT04 field-expansion variants cannot reach the global customer id through nested paths or odd encodings", async () => {
        const globalCustomerId = await globalCustomerIdOf(mariaOrder.orderId)
        const leaks: string[] = []
        const paths = [
          `/store/orders/${mariaOrder.orderId}?fields=%2Bshipping_address.customer_id`,
          `/store/orders/${mariaOrder.orderId}?fields=*shipping_address`,
          `/store/orders/${mariaOrder.orderId}?fields=*billing_address`,
          `/store/orders/${mariaOrder.orderId}?fields=*items`,
          `/store/orders/${mariaOrder.orderId}?fields[]=%2Bcustomer_id`,
          `/store/orders/${mariaOrder.orderId}?fields[x]=%2Bcustomer_id`,
          `/store/orders/${mariaOrder.orderId}?fields=%2Bid&fields=%2Bcustomer_id`,
          `/store/orders/${mariaOrder.orderId}?fields=%20%2Bcustomer_id`,
          `/store/orders/${mariaOrder.orderId}?fields=%2Bcustomer_id%20`,
          `/store/orders/${mariaOrder.orderId}?fields=*`,
          `/store/carts/${mariaOpen.cartId}?fields=%2Bshipping_address.customer_id`,
          `/store/carts/${mariaOpen.cartId}?fields=*shipping_address`,
          `/store/carts/${mariaOpen.cartId}?fields=*items`,
          `/store/carts/${mariaOpen.cartId}?fields=*payment_collection`,
          `/store/carts/${mariaOpen.cartId}?fields=*`,
        ]
        const observed: Record<string, number> = {}
        for (const p of paths) {
          const res = await call(api.get(p, sfA()))
          observed[p] = res.status
          const body = JSON.stringify(res.data ?? "")
          if (body.includes(globalCustomerId)) {
            leaks.push(`${p} (${res.status})`)
          }
        }
        // eslint-disable-next-line no-console
        console.log("RT04 observed statuses", observed)
        expect(leaks).toEqual([])
      })
    })

    // ------------------------------------------------------ foreign identifiers
    describe("foreign identifier sweep", () => {
      it("T25 every tenant-sensitive endpoint fails safely for authenticated Store A + Store B ids", async () => {
        const b = petya
        const merchantCalls: [string, () => Promise<any>][] = [
          ["GET product", () => api.get(`/merchant/products/${b.productId}`, merchantA())],
          ["POST product", () => api.post(`/merchant/products/${b.productId}`, { title: "x" }, merchantA())],
          ["DELETE product", () => api.delete(`/merchant/products/${b.productId}`, merchantA())],
          ["GET order", () => api.get(`/merchant/orders/${petyaOrder.orderId}`, merchantA())],
          ["cancel order", () => api.post(`/merchant/orders/${petyaOrder.orderId}/cancel`, {}, merchantA())],
          ["complete order", () => api.post(`/merchant/orders/${petyaOrder.orderId}/complete`, {}, merchantA())],
          ["GET stock", () => api.get(`/merchant/inventory/${b.inventoryItemId}/${b.stockLocationId}`, merchantA())],
          [
            "POST stock",
            () => api.post(`/merchant/inventory/${b.inventoryItemId}/${b.stockLocationId}`, { stocked_quantity: 1 }, merchantA()),
          ],
        ]
        const storeCalls: [string, () => Promise<any>][] = [
          ["GET product", () => api.get(`/store/products/${b.productId}`, sfA())],
          ["GET cart", () => api.get(`/store/carts/${petyaOpen.cartId}`, sfA())],
          ["POST cart", () => api.post(`/store/carts/${petyaOpen.cartId}`, { email: "evil@example.com" }, sfA())],
          [
            "POST line item",
            () => api.post(`/store/carts/${petyaOpen.cartId}/line-items`, { variant_id: maria.variantId, quantity: 1 }, sfA()),
          ],
          [
            "POST shipping method",
            () => api.post(`/store/carts/${petyaOpen.cartId}/shipping-methods`, { option_id: maria.shippingOptionId }, sfA()),
          ],
          ["POST promotions", () => api.post(`/store/carts/${petyaOpen.cartId}/promotions`, { promo_codes: [MARIA.promoCode] }, sfA())],
          ["DELETE promotions", () => api.delete(`/store/carts/${petyaOpen.cartId}/promotions`, { ...sfA(), data: { promo_codes: [PETYA.promoCode] } })],
          ["GET shipping options", () => api.get(`/store/shipping-options?cart_id=${petyaOpen.cartId}`, sfA())],
          ["complete cart", () => api.post(`/store/carts/${petyaOpen.cartId}/complete`, {}, sfA())],
          ["GET order", () => api.get(`/store/orders/${petyaOrder.orderId}`, sfA())],
        ]
        const results: Record<string, number> = {}
        for (const [name, fn] of [...merchantCalls.map(([n, f]) => [`merchant ${n}`, f] as const), ...storeCalls.map(([n, f]) => [`store ${n}`, f] as const)]) {
          const res = await call(fn())
          results[name] = res.status
          expect(JSON.stringify(res.data ?? "")).not.toContain(PETYA.productTitle)
        }
        expect(Object.values(results).every((s) => s === 404)).toBe(true)
        const { data } = await query().graph({ entity: "cart", fields: ["email", "completed_at"], filters: { id: petyaOpen.cartId } })
        expect(data[0]).toMatchObject({ email: SHOPPER_EMAIL, completed_at: null })
      })
    })

    // ---------------------------------------------------------------- spoofing
    describe("StoreEnvironment spoofing", () => {
      it("T26a storefront: client-supplied tenant selectors are rejected", async () => {
        const hdr = storefront(maria.publishableKey, { "x-store-environment-id": petya.envId })
        expect((await call(api.get("/store/products", hdr))).status).toBe(400)
        expect(
          (await call(api.post("/store/carts", { region_id: regionId, store_environment_id: petya.envId }, sfA()))).status
        ).toBe(400)
        expect(
          (await call(api.get(`/store/products?store_environment_id=${petya.envId}`, sfA()))).status
        ).toBe(400)
        expect(
          (await call(api.post(`/store/carts/${mariaOpen.cartId}`, { metadata: { tenant_id: petya.envId } }, sfA()))).status
        ).toBe(400)
      })

      it("T26b merchant: client-supplied tenant selectors are rejected", async () => {
        expect(
          (await call(api.get("/merchant/orders", bearer(maria.token, { "x-store-environment-id": petya.envId })))).status
        ).toBe(400)
        expect(
          (await call(api.get(`/merchant/orders?store_environment_id=${petya.envId}`, merchantA()))).status
        ).toBe(400)
        expect(
          (
            await call(
              api.post(`/merchant/products/${petya.productId}`, { title: "x", store_environment_id: petya.envId }, merchantA())
            )
          ).status
        ).toBe(400)
      })

      it("T26c unbound or corrupt publishable keys fail closed even when linked to a real sales channel", async () => {
        const container = getContainer()
        const {
          result: [rogueKey],
        } = await createApiKeysWorkflow(container).run({
          input: { api_keys: [{ title: "rogue", type: "publishable", created_by: "" }] },
        })
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: rogueKey.id, add: [maria.salesChannelId] },
        })
        expect((await call(api.get("/store/products", storefront(rogueKey.token)))).status).toBe(403)

        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: maria.apiKeyId, add: [petya.salesChannelId] },
        })
        expect((await call(api.get("/store/products", sfA()))).status).toBe(403)
      })

      it("T26d forged tokens, non-members and suspended environments are rejected", async () => {
        const forged = forgeJwt({ actor_id: petya.userId, actor_type: "user", auth_identity_id: "x", app_metadata: {} })
        expect((await call(api.get("/merchant/orders", bearer(forged)))).status).toBe(401)
        expect((await call(api.get("/merchant/orders"))).status).toBe(401)
        expect((await call(api.get("/merchant/orders", bearer(operatorToken)))).status).toBe(403)

        await tenancy().updateStoreEnvironments({ id: maria.envId, status: "suspended" })
        expect((await call(api.get("/store/products", sfA()))).status).toBe(403)
        expect((await call(api.get("/merchant/orders", merchantA()))).status).toBe(403)
        expect((await call(api.get("/store/products", sfB()))).status).toBe(200)
      })
    })

    // ------------------------------------------------------------ tool boundary
    describe("typed tool boundary (future AI operator)", () => {
      it("T27 tools get tenant identity only from the server context", async () => {
        const container = getContainer()
        const ctxA = await buildMerchantExecutionContext(container, maria.userId)
        expect(ctxA.store_environment.id).toBe(maria.envId)
        expect(Object.isFrozen(ctxA)).toBe(true)
        expect(() => {
          ;(ctxA as any).store_environment = { id: petya.envId }
        }).toThrow()

        await expect(
          executeTenantTool(ctxA, MERCHANT_TOOLS["orders.get_order"], { order_id: petyaOrder.orderId })
        ).rejects.toMatchObject({ type: "not_found" })
        await expect(
          executeTenantTool(ctxA, MERCHANT_TOOLS["orders.get_order"], {
            order_id: mariaOrder.orderId,
            store_environment_id: petya.envId,
          })
        ).rejects.toThrow(/must not select a tenant/)
        await expect(
          executeTenantTool(ctxA, MERCHANT_TOOLS["catalogue.update_product"], {
            product_id: petya.productId,
            title: "hacked",
          })
        ).rejects.toMatchObject({ type: "not_found" })
        await expect(
          executeTenantTool(ctxA, MERCHANT_TOOLS["inventory.set_stock"], {
            inventory_item_id: petya.inventoryItemId,
            location_id: petya.stockLocationId,
            stocked_quantity: 0,
          })
        ).rejects.toMatchObject({ type: "not_found" })

        const own: any = await executeTenantTool(ctxA, MERCHANT_TOOLS["orders.get_order"], {
          order_id: mariaOrder.orderId,
        })
        expect(own.id).toBe(mariaOrder.orderId)
        const shoppers: any = await executeTenantTool(ctxA, MERCHANT_TOOLS["shoppers.list"], {})
        expect(shoppers.map((s: any) => s.order_ids)).toEqual([[mariaOrder.orderId]])
      })
    })

    // ------------------------------------------- sales channel ≠ authorization
    describe("sales-channel visibility is not authorization", () => {
      it("T28 even if Store B's product is linked into Store A's sales channel and stock location, Store A cannot see or buy it", async () => {
        const container = getContainer()
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.create({
          [Modules.PRODUCT]: { product_id: petya.productId },
          [Modules.SALES_CHANNEL]: { sales_channel_id: maria.salesChannelId },
        })
        await link.create({
          [Modules.SALES_CHANNEL]: { sales_channel_id: maria.salesChannelId },
          [Modules.STOCK_LOCATION]: { stock_location_id: petya.stockLocationId },
        })
        const { data: misconfigured } = await query().graph({
          entity: "product_sales_channel",
          fields: ["product_id"],
          filters: { sales_channel_id: maria.salesChannelId },
        })
        expect(misconfigured.map((l: any) => l.product_id)).toContain(petya.productId)

        const list = await api.get("/store/products", sfA())
        expect(JSON.stringify(list.data)).not.toContain(PETYA.productTitle)
        expect((await call(api.get(`/store/products/${petya.productId}`, sfA()))).status).toBe(404)
        const { data } = await api.post("/store/carts", { region_id: regionId }, sfA())
        expect(
          (await call(api.post(`/store/carts/${data.cart.id}/line-items`, { variant_id: petya.variantId, quantity: 1 }, sfA())))
            .status
        ).toBe(404)
        await runWorkflowExpectingViolation(addToCartWorkflowId, {
          cart_id: data.cart.id,
          items: [{ variant_id: petya.variantId, quantity: 1 }],
        })
      })
    })

    // ------------------------------------------------------ hostname, ownership
    describe("hostname resolution, ownership integrity, cache surface", () => {
      it("T29 hostnames resolve only by exact normalised match to active environments", async () => {
        const t = tenancy()
        expect((await t.resolveStoreEnvironmentByHostname("MARIA-CANDLES.shops.test:443"))?.id).toBe(maria.envId)
        expect((await t.resolveStoreEnvironmentByHostname("petya-jewellery.shops.test."))?.id).toBe(petya.envId)
        for (const host of [
          "maria-candles.shops.test.evil.com",
          "evil-maria-candles.shops.test",
          "shops.test",
          "maria-candles.shops.test/petya-jewellery.shops.test",
          "",
        ]) {
          expect(await t.resolveStoreEnvironmentByHostname(host)).toBeNull()
        }
        await t.updateStoreEnvironments({ id: petya.envId, status: "suspended" })
        expect(await t.resolveStoreEnvironmentByHostname("petya-jewellery.shops.test")).toBeNull()
      })

      it("T31 ownership is single-owner (DB-enforced) and unowned resources are invisible (fail closed)", async () => {
        const container = getContainer()
        const t = tenancy()
        await expect(t.claimResources(maria.envId, "product", [petya.productId])).rejects.toThrow(ISOLATION_VIOLATION)
        await expect(
          t.createResourceOwnerships({ resource_type: "product", resource_id: petya.productId, store_environment_id: maria.envId })
        ).rejects.toThrow()

        const {
          result: [orphan],
        } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: "Unowned Orphan Product",
                status: "published",
                options: [{ title: "Size", values: ["One"] }],
                variants: [{ title: "One", options: { Size: "One" }, manage_inventory: false, prices: [{ amount: 1, currency_code: "eur" }] }],
                sales_channels: [{ id: maria.salesChannelId }],
              },
            ],
          },
        })
        const list = await api.get("/store/products", sfA())
        expect(JSON.stringify(list.data)).not.toContain("Unowned Orphan Product")
        expect((await call(api.get(`/store/products/${orphan.id}`, sfA()))).status).toBe(404)
        expect((await call(api.get(`/merchant/products/${orphan.id}`, merchantA()))).status).toBe(404)
      })

      it("T30 no tenant-sensitive cache surface exists in M0 (Medusa core caching disabled)", async () => {
        expect(FeatureFlag.isFeatureEnabled("caching")).toBe(false)
      })

      it("T32 media/upload surface: merchants cannot use the native upload API", async () => {
        expect((await call(api.post(`/admin/uploads`, {}, merchantA()))).status).toBe(403)
      })

      it("T33 path-normalisation tricks cannot bypass the storefront, merchant or admin guards", async () => {
        const orderB = petyaOrder.orderId
        const observed: Record<string, number> = {}
        const leaks = (res: { status: number; data: any }) =>
          res.status === 200 || JSON.stringify(res.data ?? "").includes(PETYA.variantTitle)

        for (const p of [
          `/STORE/orders/${orderB}`,
          `/Store/Orders/${orderB}/`,
          `/store/orders/${orderB}?fields=*items`,
          `/store//orders/${orderB}`,
          `/store/%6Frders/${orderB}`,
          `/store/orders/${encodeURIComponent(orderB)}%20`,
        ]) {
          const res = await call(api.get(p, sfA()))
          observed[`store ${p}`] = res.status
          expect({ p, leaked: leaks(res) }).toEqual({ p, leaked: false })
        }
        for (const p of [`/MERCHANT/orders/${orderB}`, `/merchant//orders/${orderB}`, `/Merchant/orders/`]) {
          const res = await call(api.get(p, merchantA()))
          observed[`merchant ${p}`] = res.status
          expect({ p, leaked: leaks(res) && p.includes(orderB) }).toEqual({ p, leaked: false })
        }
        for (const p of [`/ADMIN/orders/${orderB}`, `/admin//orders/${orderB}`, `/Admin/orders`]) {
          const res = await call(api.get(p, merchantA()))
          observed[`admin ${p}`] = res.status
          expect({ p, ok: res.status === 200 }).toEqual({ p, ok: false })
        }
        // eslint-disable-next-line no-console
        console.log("T33 observed statuses", observed)
      })
    })
  },
})
