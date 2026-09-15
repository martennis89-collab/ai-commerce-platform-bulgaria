/**
 * storefront-core 0.3.0 — the one deterministic storefront renderer.
 *
 * Used by every per-project static build (template/app/page.jsx) and by the
 * authenticated in-admin draft preview (M3-D1), so what the merchant edits is
 * what the build renders. All text is plain text (React escapes it); photos
 * come only from the server-resolved `media` map of owned media ids; theme
 * values come only from validated tokens. Every editable element carries a
 * stable `data-amb-element` id derived from its schema path.
 */

const el = (sectionId, field) => (field ? `section:${sectionId}/${field}` : `section:${sectionId}`)
const itemEl = (sectionId, index, field) => `section:${sectionId}/items/${index}/${field}`

export function themeStyle(theme) {
  return {
    "--paper": theme.colors.paper,
    "--ink": theme.colors.ink,
    "--muted": theme.colors.muted,
    "--accent": theme.colors.accent,
    "--accent-ink": theme.colors.accent_ink,
    "--line": theme.colors.line,
    "--radius": theme.corner === "square" ? "2px" : "8px",
  }
}

export function formatPrice(amount, currencyCode, locale) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: String(currencyCode).toUpperCase() }).format(amount)
  } catch {
    return null
  }
}

const paragraphs = (text) =>
  String(text ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

const mediaUrl = (media, ref) => (ref && media && media[ref.media_id] ? media[ref.media_id].url : null)

function Hero({ section, media }) {
  const photo = section.variant === "image" ? mediaUrl(media, section.image) : null
  return (
    <section
      className={`hero frame${photo ? " hero--image" : ""}`}
      aria-labelledby={`${section.id}-title`}
      data-amb-element={el(section.id)}
    >
      <div className="hero-copy">
        <h1 id={`${section.id}-title`} data-amb-element={el(section.id, "headline")}>
          {section.headline}
        </h1>
        {section.subheadline ? (
          <p className="hero-sub" data-amb-element={el(section.id, "subheadline")}>
            {section.subheadline}
          </p>
        ) : null}
        <a className="button" href="#products" data-amb-element={el(section.id, "cta_label")}>
          {section.cta_label}
        </a>
      </div>
      {photo ? (
        <div className="hero-media" data-amb-element={el(section.id, "image")}>
          <img src={photo} alt="" />
        </div>
      ) : null}
    </section>
  )
}

function Highlights({ section }) {
  return (
    <section
      className={`highlights frame highlights--${section.variant}`}
      aria-labelledby={`${section.id}-title`}
      data-amb-element={el(section.id)}
    >
      <h2 id={`${section.id}-title`} data-amb-element={el(section.id, "title")}>
        {section.title}
      </h2>
      <ul className="highlight-list">
        {section.items.map((item, i) => (
          <li key={i} className="highlight">
            <h3 data-amb-element={itemEl(section.id, i, "title")}>{item.title}</h3>
            {item.text ? <p data-amb-element={itemEl(section.id, i, "text")}>{item.text}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProductGrid({ section, products, store }) {
  const compact = section.variant === "compact"
  return (
    <section
      id="products"
      className="products frame"
      aria-labelledby={`${section.id}-title`}
      data-amb-element={el(section.id)}
    >
      <div className="section-head">
        <h2 id={`${section.id}-title`} data-amb-element={el(section.id, "title")}>
          {section.title}
        </h2>
        {products.length > 0 ? <span className="count">{products.length}</span> : null}
      </div>
      {products.length === 0 ? (
        <p className="empty" data-amb-element={el(section.id, "empty_state")}>
          {section.empty_state}
        </p>
      ) : (
        <ul className={compact ? "product-list" : "product-grid"}>
          {products.map((product) => {
            const price = product.price && product.price.amount != null ? formatPrice(product.price.amount, product.price.currency_code ?? store.currency_code, store.locale) : null
            return (
              <li key={product.id} className="product" data-product-id={product.id}>
                <div className="product-media">
                  {product.thumbnail ? (
                    <img src={product.thumbnail} alt={product.title} loading="lazy" />
                  ) : (
                    <span aria-hidden="true">{String(product.title).slice(0, 1)}</span>
                  )}
                </div>
                <div className="product-info">
                  <h3>{product.title}</h3>
                  {price ? <p className="price">{price}</p> : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ImageBanner({ section, media }) {
  const photo = mediaUrl(media, section.image)
  return (
    <section className={`banner banner--${section.variant}${section.variant === "contained" ? " frame" : ""}`} data-amb-element={el(section.id)}>
      {photo ? (
        <figure className="banner-figure" data-amb-element={el(section.id, "image")}>
          <img src={photo} alt={section.alt} />
        </figure>
      ) : null}
      {section.caption ? (
        <p className="banner-caption frame" data-amb-element={el(section.id, "caption")}>
          {section.caption}
        </p>
      ) : null}
    </section>
  )
}

function About({ section, media, draft }) {
  const body = paragraphs(section.body)
  const photo = section.variant === "image" ? mediaUrl(media, section.image) : null
  if (!body.length && !draft) {
    return null
  }
  return (
    <section
      className={`about frame${photo ? " about--image" : ""}`}
      aria-labelledby={`${section.id}-title`}
      data-amb-element={el(section.id)}
    >
      <div className="about-copy">
        <h2 id={`${section.id}-title`} data-amb-element={el(section.id, "title")}>
          {section.title}
        </h2>
        <div className="about-body" data-amb-element={el(section.id, "body")}>
          {body.length ? body.map((p, i) => <p key={i}>{p}</p>) : <p className="draft-placeholder">Текстът за вас още не е добавен.</p>}
        </div>
      </div>
      {photo ? (
        <div className="about-media" data-amb-element={el(section.id, "image")}>
          <img src={photo} alt="" />
        </div>
      ) : null}
    </section>
  )
}

function Faq({ section }) {
  return (
    <section className={`faq frame faq--${section.variant}`} aria-labelledby={`${section.id}-title`} data-amb-element={el(section.id)}>
      <h2 id={`${section.id}-title`} data-amb-element={el(section.id, "title")}>
        {section.title}
      </h2>
      <div className="faq-items">
        {section.items.map((item, i) =>
          section.variant === "details" ? (
            <details key={i} className="faq-item">
              <summary data-amb-element={itemEl(section.id, i, "question")}>{item.question}</summary>
              <div className="faq-answer" data-amb-element={itemEl(section.id, i, "answer")}>
                {paragraphs(item.answer).map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </div>
            </details>
          ) : (
            <div key={i} className="faq-item">
              <h3 data-amb-element={itemEl(section.id, i, "question")}>{item.question}</h3>
              <div className="faq-answer" data-amb-element={itemEl(section.id, i, "answer")}>
                {paragraphs(item.answer).map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </section>
  )
}

const SECTIONS = {
  hero: Hero,
  highlights: Highlights,
  product_grid: ProductGrid,
  image_banner: ImageBanner,
  about: About,
  faq: Faq,
}

/**
 * @param {{ config: any, products?: Array<{id:string,title:string,thumbnail?:string|null,price?:{amount:number,currency_code?:string}|null}>, media?: Record<string,{url:string}>, draft?: boolean }} props
 */
export function StorefrontPage({ config, products = [], media = {}, draft = false }) {
  const { store, theme, home } = config
  return (
    <div className="amb-storefront" data-typography={theme.typography} style={themeStyle(theme)}>
      <header className="site-header">
        <div className="frame site-header-inner">
          <a className="wordmark" href="#top">
            {store.name}
          </a>
        </div>
      </header>
      <main id="top">
        {home.sections.map((section) => {
          const Section = SECTIONS[section.type]
          return Section ? (
            <Section key={section.id} section={section} products={products} media={media} store={store} draft={draft} />
          ) : null
        })}
      </main>
      <footer className="site-footer">
        <div className="frame">{store.name}</div>
      </footer>
    </div>
  )
}
