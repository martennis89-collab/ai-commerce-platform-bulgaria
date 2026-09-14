import { formatPrice, getManifest, loadCatalogue } from "../lib/storefront"

export default async function StorefrontHome() {
  const { config } = getManifest()
  const { products } = await loadCatalogue()

  return (
    <main className="shell">
      <header className="shell-header">
        <h1>{config.store.name}</h1>
      </header>
      <section aria-label="Продукти" className="product-grid">
        {products.length === 0 ? (
          <p className="empty">Скоро очаквайте продукти.</p>
        ) : (
          products.map((product) => {
            const price = product.variants?.[0]?.calculated_price
            return (
              <article key={product.id} className="product-card" data-product-id={product.id}>
                <h2>{product.title}</h2>
                {price?.calculated_amount != null ? (
                  <p className="price">
                    {formatPrice(
                      price.calculated_amount,
                      price.currency_code ?? config.store.currency_code,
                      config.store.locale
                    )}
                  </p>
                ) : null}
              </article>
            )
          })
        )}
      </section>
    </main>
  )
}
