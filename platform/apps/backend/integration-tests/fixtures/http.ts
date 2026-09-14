import crypto from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { MerchantCommerceFixture } from "./commerce"

export type HttpResult = { status: number; data: any }

/** Resolves to status/body for both 2xx and error responses. */
export async function call(p: Promise<any>): Promise<HttpResult> {
  try {
    const r = await p
    return { status: r.status, data: r.data }
  } catch (e: any) {
    if (!e.response) {
      throw e
    }
    return { status: e.response.status, data: e.response.data }
  }
}

export const storefront = (publishableKey: string, extraHeaders: Record<string, string> = {}) => ({
  headers: { "x-publishable-api-key": publishableKey, ...extraHeaders },
})

export const bearer = (token: string, extraHeaders: Record<string, string> = {}) => ({
  headers: { authorization: `Bearer ${token}`, ...extraHeaders },
})

/** Real emailpass registration + login flow; the platform links the auth identity to a user. */
export async function createUserWithToken(
  container: MedusaContainer,
  api: any,
  email: string,
  password = "M0-test-password!"
) {
  await api.post("/auth/user/emailpass/register", { email, password })
  const userModule = container.resolve(Modules.USER)
  const user = await userModule.createUsers({ email })
  const authModule = container.resolve(Modules.AUTH)
  const [identity] = await authModule.listProviderIdentities({ entity_id: email, provider: "emailpass" })
  await authModule.updateAuthIdentities({
    id: identity.auth_identity_id!,
    app_metadata: { user_id: user.id },
  })
  const {
    data: { token },
  } = await api.post("/auth/user/emailpass", { email, password })
  return { user, token: token as string }
}

/** HS256 JWT signed with an attacker-chosen secret. */
export function forgeJwt(payload: Record<string, unknown>, secret = "attacker-secret") {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`
  const sig = crypto.createHmac("sha256", secret).update(unsigned).digest("base64url")
  return `${unsigned}.${sig}`
}

export const SHIPPING_ADDRESS = {
  first_name: "Test",
  last_name: "Shopper",
  address_1: "ul. Vitosha 1",
  city: "Sofia",
  country_code: "bg",
  postal_code: "1000",
  phone: "+359888000000",
}

/** Cart with one item, address, shipping method and a payment session; not completed. */
export async function prepareCart(
  api: any,
  m: MerchantCommerceFixture,
  regionId: string,
  email: string
) {
  const h = storefront(m.publishableKey)
  const {
    data: { cart },
  } = await api.post("/store/carts", { region_id: regionId, email }, h)
  await api.post(`/store/carts/${cart.id}/line-items`, { variant_id: m.variantId, quantity: 1 }, h)
  await api.post(`/store/carts/${cart.id}`, { shipping_address: SHIPPING_ADDRESS }, h)
  const {
    data: { shipping_options },
  } = await api.get(`/store/shipping-options?cart_id=${cart.id}`, h)
  await api.post(`/store/carts/${cart.id}/shipping-methods`, { option_id: shipping_options[0].id }, h)
  const {
    data: { payment_collection },
  } = await api.post(`/store/payment-collections`, { cart_id: cart.id }, h)
  await api.post(
    `/store/payment-collections/${payment_collection.id}/payment-sessions`,
    { provider_id: "pp_system_default" },
    h
  )
  const {
    data: { cart: refreshed },
  } = await api.get(`/store/carts/${cart.id}`, h)
  return {
    cartId: cart.id as string,
    paymentCollectionId: payment_collection.id as string,
    lineItemId: refreshed.items[0].id as string,
  }
}

export async function checkout(api: any, m: MerchantCommerceFixture, regionId: string, email: string) {
  const prepared = await prepareCart(api, m, regionId, email)
  const { data } = await api.post(
    `/store/carts/${prepared.cartId}/complete`,
    {},
    storefront(m.publishableKey)
  )
  if (data.type !== "order") {
    throw new Error(`checkout failed: ${JSON.stringify(data)}`)
  }
  return { ...prepared, orderId: data.order.id as string, order: data.order }
}
