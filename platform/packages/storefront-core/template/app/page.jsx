import { StorefrontPage } from "../components/StorefrontPage"
import { getManifest, loadCatalogue } from "../lib/storefront"

export default async function StorefrontHome() {
  const { config, media } = getManifest()
  const { products } = await loadCatalogue()
  const rendered = products.map((product) => {
    const price = product.variants?.[0]?.calculated_price
    return {
      id: product.id,
      title: product.title,
      thumbnail: product.thumbnail ?? null,
      price:
        price?.calculated_amount != null
          ? { amount: price.calculated_amount, currency_code: price.currency_code ?? config.store.currency_code }
          : null,
    }
  })
  return <StorefrontPage config={config} products={rendered} media={media ?? {}} />
}
