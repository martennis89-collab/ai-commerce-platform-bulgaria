import Medusa from "@medusajs/js-sdk"
import manifest from "../platform-deployment.json"

/** The single, server-built deployment manifest this build was materialised with. */
export function getManifest() {
  return manifest
}

const sdk = new Medusa({
  baseUrl: manifest.backend_url,
  publishableKey: manifest.publishable_key,
})

/** Build-time catalogue read through this environment's own publishable key. */
export async function loadCatalogue() {
  const { regions } = await sdk.store.region.list({ limit: 1 })
  const region = regions?.[0]
  const { products } = await sdk.store.product.list({
    limit: 100,
    fields: "id,title,handle,thumbnail,*variants.calculated_price",
    ...(region ? { region_id: region.id } : {}),
  })
  return { region, products: products ?? [] }
}

export function formatPrice(amount, currencyCode, locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: String(currencyCode).toUpperCase(),
  }).format(amount)
}
