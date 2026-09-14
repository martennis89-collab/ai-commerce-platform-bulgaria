import { formatPrice, getManifest, loadCatalogue } from "../lib/storefront"

export default async function StorefrontHome() {
  const { config } = getManifest()
  const { store, home } = config
  const { products } = await loadCatalogue()
  const aboutParagraphs = home.about.body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <>
      <header className="site-header">
        <div className="frame site-header-inner">
          <a className="wordmark" href="#top">
            {store.name}
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero frame" aria-labelledby="hero-title">
          <h1 id="hero-title">{home.hero.headline}</h1>
          {home.hero.subheadline ? <p className="hero-sub">{home.hero.subheadline}</p> : null}
          <a className="button" href="#products">
            {home.hero.cta_label}
          </a>
        </section>

        <section id="products" className="products frame" aria-labelledby="products-title">
          <div className="section-head">
            <h2 id="products-title">{home.product_grid.title}</h2>
            {products.length > 0 ? <span className="count">{products.length}</span> : null}
          </div>
          {products.length === 0 ? (
            <p className="empty">{home.product_grid.empty_state}</p>
          ) : (
            <ul className="product-grid">
              {products.map((product) => {
                const price = product.variants?.[0]?.calculated_price
                return (
                  <li key={product.id} className="product" data-product-id={product.id}>
                    <div className="product-media">
                      {product.thumbnail ? (
                        <img src={product.thumbnail} alt={product.title} loading="lazy" />
                      ) : (
                        <span aria-hidden="true">{product.title.slice(0, 1)}</span>
                      )}
                    </div>
                    <h3>{product.title}</h3>
                    {price?.calculated_amount != null ? (
                      <p className="price">
                        {formatPrice(
                          price.calculated_amount,
                          price.currency_code ?? store.currency_code,
                          store.locale
                        )}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {aboutParagraphs.length > 0 ? (
          <section className="about frame" aria-labelledby="about-title">
            <h2 id="about-title">{home.about.title}</h2>
            <div className="about-body">
              {aboutParagraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="site-footer">
        <div className="frame">{store.name}</div>
      </footer>
    </>
  )
}
