/**
 * M3 contracts that need no database: storefront-schema v3 design space,
 * element-id resolution, the preview bridge, designer operations, the
 * screenshot network policy and the rate-limit response.
 */
import fs from "fs"
import os from "os"
import path from "path"
import {
  defaultStorefrontConfig,
  ELEMENT_ID_MAX_LENGTH,
  findSection,
  parseStorefrontConfig,
  resolveElement,
  StorefrontConfig,
} from "@platform/storefront-schema"
import { readFrameMessage, readParentMessage } from "@platform/storefront-core"
import {
  applyAddSection,
  applyAttachPhoto,
  applyCopy,
  applyRemoveSection,
  applyReorder,
  applyThemeTokens,
  applyVariant,
  DesignerOperationError,
} from "../operations"
import { artifactFileFor, decideScreenshotRequest } from "../screenshots"
import { RateLimitError, respondRateLimited } from "../../storefront/rate-limits"

const MEDIA = "media_01M2EK8A2E0K44AX3V5XH27XRG"

const richConfig = (): StorefrontConfig =>
  parseStorefrontConfig({
    ...defaultStorefrontConfig("Maria Candles"),
    home: {
      sections: [
        { id: "hero-1", type: "hero", variant: "text", headline: "Maria Candles", subheadline: "Соеви свещи", cta_label: "Към продуктите", image: null },
        { id: "highlights-1", type: "highlights", variant: "list", title: "Защо ние", items: [{ title: "Ръчна изработка", text: "Малки партиди" }] },
        { id: "product_grid-1", type: "product_grid", variant: "grid", title: "Продукти", empty_state: "Скоро" },
        { id: "faq-1", type: "faq", variant: "list", title: "Въпроси", items: [{ question: "Колко горят?", answer: "Около 40 часа." }] },
        { id: "about-1", type: "about", variant: "text", title: "За нас", body: "Работилница в София.", image: null },
      ],
    },
  })

describe("storefront-schema v3 design space (M3-T12)", () => {
  it("accepts the default and the full section library", () => {
    expect(findSection(defaultStorefrontConfig("Maria"), "hero")!.headline).toBe("Maria")
    expect(richConfig().home.sections).toHaveLength(5)
  })

  it("upgrades v2 configs to v3 losslessly", () => {
    const v2 = {
      schema_version: 2,
      store: { name: "Maria", locale: "bg-BG", currency_code: "eur" },
      theme: defaultStorefrontConfig("Maria").theme,
      home: {
        hero: { headline: "Свещи", subheadline: "Ръчно", cta_label: "Разгледай" },
        product_grid: { title: "Всичко", empty_state: "Скоро" },
        about: { title: "За нас", body: "Текст" },
      },
    }
    const v3 = parseStorefrontConfig(v2)
    expect(v3.schema_version).toBe(3)
    expect(findSection(v3, "hero")).toMatchObject({ headline: "Свещи", subheadline: "Ръчно", cta_label: "Разгледай", variant: "text" })
    expect(findSection(v3, "product_grid")).toMatchObject({ title: "Всичко", empty_state: "Скоро" })
    expect(findSection(v3, "about")).toMatchObject({ title: "За нас", body: "Текст" })
  })

  const withSections = (mutate: (sections: any[]) => void) => {
    const config: any = JSON.parse(JSON.stringify(richConfig()))
    mutate(config.home.sections)
    return config
  }

  it.each([
    ["hero not first", withSections((s) => s.reverse())],
    ["two product grids", withSections((s) => s.push({ ...s[2], id: "product_grid-2" }))],
    ["no product grid", withSections((s) => s.splice(2, 1))],
    ["an unknown section type", withSections((s) => s.push({ id: "html-1", type: "html", variant: "raw", markup: "<script>" }))],
    ["an unknown variant", withSections((s) => (s[1].variant = "carousel"))],
    ["an image variant without a photo", withSections((s) => (s[0].variant = "image"))],
    ["a photo given as a URL", withSections((s) => (s[0].image = { media_id: "https://evil.example/x.png" }))],
    ["a javascript: photo", withSections((s) => (s[0].image = { url: "javascript:alert(1)" }))],
    ["duplicate section ids", withSections((s) => s.push({ ...s[3] }))],
    ["a mismatched id prefix", withSections((s) => (s[3].id = "hero-9"))],
    ["too many sections", withSections((s) => { for (let i = 2; i < 6; i++) s.push({ ...s[3], id: `faq-${i}` }) })],
    ["too many highlights", withSections((s) => (s[1].items = Array.from({ length: 4 }, () => ({ title: "x", text: "" }))))],
    ["too many FAQ items", withSections((s) => (s[3].items = Array.from({ length: 7 }, () => ({ question: "x", answer: "y" }))))],
    ["a headline over 60 characters", withSections((s) => (s[0].headline = "x".repeat(61)))],
    ["a custom CSS field", withSections((s) => (s[0].css = "body{display:none}"))],
  ])("rejects %s", (_label, config) => {
    expect(() => parseStorefrontConfig(config)).toThrow(/Invalid storefront config/)
  })
})

describe("element ids (M3-T01, M3-T02)", () => {
  const config = richConfig()

  it("resolves sections, fields and list items with Bulgarian labels", () => {
    expect(resolveElement(config, "section:hero-1")).toMatchObject({ section_type: "hero", field: null, label: "Начален блок" })
    expect(resolveElement(config, "section:hero-1/headline")).toMatchObject({ field: "headline", value: "Maria Candles", label: "Заглавие" })
    expect(resolveElement(config, "section:faq-1/items/0/answer")).toMatchObject({ item_index: 0, value: "Около 40 часа.", label: "Отговор 1" })
  })

  it.each([
    ["a malformed id", "hero-1/headline"],
    ["an unknown section", "section:about-7/title"],
    ["a field of another type", "section:hero-1/body"],
    ["an out-of-range item", "section:faq-1/items/3/question"],
    ["an item field on a section without items", "section:hero-1/items/0/title"],
    ["prototype keys", "section:hero-1/__proto__"],
    ["path traversal", "section:hero-1/../about-1"],
    ["an over-long id", `section:hero-1/${"a".repeat(ELEMENT_ID_MAX_LENGTH)}`],
    ["a non-string", { id: "section:hero-1" }],
  ])("returns null for %s", (_label, id) => {
    expect(resolveElement(config, id)).toBeNull()
  })
})

describe("preview bridge (M3-T13)", () => {
  const frameWindow = { name: "frame" }
  const parentWindow = { name: "parent" }
  const origin = "http://localhost:7001"
  const select = { source: "amboras-frame", type: "select", element_id: "section:hero-1/headline" }

  it("accepts a well-formed message from the exact frame window and origin", () => {
    expect(readFrameMessage({ origin, source: frameWindow, data: select }, { origin, source: frameWindow })).toEqual(select)
  })

  it.each([
    ["another origin", { origin: "http://evil.example", source: frameWindow, data: select }, { origin, source: frameWindow }],
    ["a look-alike origin", { origin: "http://localhost:7001.evil.example", source: frameWindow, data: select }, { origin, source: frameWindow }],
    ["another window", { origin, source: { name: "popup" }, data: select }, { origin, source: frameWindow }],
    ["a wildcard expectation", { origin: "*", source: frameWindow, data: select }, { origin: "*", source: frameWindow }],
    ["an opaque origin", { origin: "null", source: frameWindow, data: select }, { origin: "null", source: frameWindow }],
    ["extra keys", { origin, source: frameWindow, data: { ...select, store_environment_id: "senv_x" } }, { origin, source: frameWindow }],
    ["a forged element id", { origin, source: frameWindow, data: { ...select, element_id: "section:hero-1/../../x" } }, { origin, source: frameWindow }],
    ["a wrong message source", { origin, source: frameWindow, data: { ...select, source: "amboras-designer" } }, { origin, source: frameWindow }],
    ["a missing expected window", { origin, source: frameWindow, data: select }, { origin, source: null }],
  ])("rejects %s", (_label, event, expected) => {
    expect(readFrameMessage(event as any, expected as any)).toBeNull()
  })

  it("validates render payloads before the frame renders anything", () => {
    const render = {
      source: "amboras-designer",
      type: "render",
      render: { config: richConfig(), products: [], media: { [MEDIA]: { url: "http://localhost:9000/static/x.png" } }, selected_element_id: null },
    }
    expect(readParentMessage({ origin, source: parentWindow, data: render }, { origin, source: parentWindow })?.type).toBe("render")
    const evilMedia = { ...render, render: { ...render.render, media: { [MEDIA]: { url: "javascript:alert(1)" } } } }
    expect(readParentMessage({ origin, source: parentWindow, data: evilMedia }, { origin, source: parentWindow })).toBeNull()
    expect(readParentMessage({ origin: "http://evil.example", source: parentWindow, data: render }, { origin, source: parentWindow })).toBeNull()
  })
})

describe("designer operations (M3-T04)", () => {
  it("applies each bounded operation and describes it in Bulgarian", () => {
    const base = richConfig()
    expect(applyCopy(base, { section_id: "hero-1", field: "headline", item_index: null, value: "Свещи" }).summary).toContain("заглавието")
    expect(applyCopy(base, { section_id: "faq-1", field: "answer", item_index: 0, value: "30 часа." }).config.home.sections[3]).toMatchObject({ items: [{ answer: "30 часа." }] })
    const reordered = applyReorder(base, { order: ["hero-1", "product_grid-1", "highlights-1", "faq-1", "about-1"] })
    expect(reordered.config.home.sections.map((s) => s.id)).toEqual(["hero-1", "product_grid-1", "highlights-1", "faq-1", "about-1"])
    expect(applyVariant(base, { section_id: "highlights-1", variant: "columns" }).config.home.sections[1].variant).toBe("columns")
    const added = applyAddSection(base, { type: "faq", after_section_id: "about-1", title: "Още въпроси", text: null, items: [{ title: "Доставка?", text: "С куриер." }], media_id: null })
    expect(parseStorefrontConfig(added.config).home.sections.at(-1)).toMatchObject({ id: "faq-2", items: [{ question: "Доставка?", answer: "С куриер." }] })
    expect(applyRemoveSection(base, { section_id: "faq-1" }).config.home.sections).toHaveLength(4)
    const photo = applyAttachPhoto(base, { section_id: "hero-1", media_id: MEDIA })
    expect(parseStorefrontConfig(photo.config).home.sections[0]).toMatchObject({ variant: "image", image: { media_id: MEDIA } })
    const theme = applyThemeTokens(base, { typography: "modern", corner: null, colors: null })
    expect(theme.config.theme.typography).toBe("modern")
  })

  it.each([
    ["an unknown section", () => applyCopy(richConfig(), { section_id: "about-9", field: "title", item_index: null, value: "x" })],
    ["a field the section does not have", () => applyCopy(richConfig(), { section_id: "hero-1", field: "body", item_index: null, value: "x" })],
    ["a missing list item", () => applyCopy(richConfig(), { section_id: "faq-1", field: "answer", item_index: 5, value: "x" })],
    ["an order that drops a section", () => applyReorder(richConfig(), { order: ["hero-1", "product_grid-1"] })],
    ["a variant of another type", () => applyVariant(richConfig(), { section_id: "faq-1", variant: "columns" })],
    ["a banner without a photo", () => applyAddSection(richConfig(), { type: "image_banner", after_section_id: "hero-1", title: "x", text: null, items: null, media_id: null })],
    ["a photo on a section without a photo slot", () => applyAttachPhoto(richConfig(), { section_id: "faq-1", media_id: MEDIA })],
    ["a no-op theme change", () => applyThemeTokens(richConfig(), { typography: null, corner: null, colors: null })],
  ])("refuses %s", (_label, run) => {
    expect(run).toThrow(DesignerOperationError)
  })

  it("never yields a config the schema accepts when an operation breaks the rules", () => {
    const removeHero = applyRemoveSection(richConfig(), { section_id: "hero-1" })
    expect(() => parseStorefrontConfig(removeHero.config)).toThrow(/hero/)
    const unreadable = applyThemeTokens(richConfig(), {
      typography: null,
      corner: null,
      colors: { paper: "#ffffff", ink: "#eeeeee", muted: null, accent: null, accent_ink: null, line: null },
    })
    expect(() => parseStorefrontConfig(unreadable.config)).toThrow(/contrast/)
  })
})

describe("screenshot network policy (M3-T08)", () => {
  const env = "senv_01M2EK8A2E0K44AX3V5XH27XRG"
  let artifact: string

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "m3-shot-"))
    artifact = path.join(base, "out")
    fs.mkdirSync(path.join(artifact, "_next"), { recursive: true })
    fs.writeFileSync(path.join(artifact, "index.html"), "<h1>Maria</h1>")
    fs.writeFileSync(path.join(artifact, "_next", "app.js"), "1")
    fs.writeFileSync(path.join(base, "secret.txt"), "secret")
    artifact = fs.realpathSync(artifact)
  })

  const decide = (url: string, method = "GET") =>
    decideScreenshotRequest({
      url,
      method,
      previewOrigin: "https://maria-candles.preview.localhost",
      backendOrigin: "http://localhost:9000",
      storeEnvironmentId: env,
      realArtifact: artifact,
    })

  it("serves only the deployment's own artifact for the preview origin", () => {
    expect(decide("https://maria-candles.preview.localhost/")).toEqual({ kind: "artifact", file: path.join(artifact, "index.html") })
    expect(decide("https://maria-candles.preview.localhost/_next/app.js").kind).toBe("artifact")
    expect(decide("https://maria-candles.preview.localhost/%2e%2e/secret.txt")).toEqual({ kind: "artifact", file: null })
    expect(artifactFileFor(artifact, "/../secret.txt")).toBeNull()
  })

  it.each([
    ["a write to the preview origin", "https://maria-candles.preview.localhost/", "POST"],
    ["another store's preview", "https://petya-jewellery.preview.localhost/", "GET"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/", "GET"],
    ["the backend API", "http://localhost:9000/merchant/designer", "GET"],
    ["another store's media", "http://localhost:9000/static/senv_OTHER/x.png", "GET"],
    ["traversal out of the store's media", "http://localhost:9000/static/" + env + "/../senv_OTHER/x.png", "GET"],
    ["a local file", "file:///etc/passwd", "GET"],
    ["a data URL", "data:text/html,<script>", "GET"],
  ])("aborts %s", (_label, url, method) => {
    expect(decide(url, method).kind === "media" && !url.includes(`/static/${env}/`)).toBe(false)
    if (!url.startsWith(`http://localhost:9000/static/${env}/`)) {
      expect(decide(url, method).kind).not.toBe("media")
    }
    expect(decide(url, method).kind === "artifact" && method !== "GET").toBe(false)
  })

  it("allows only GETs of the store's own uploaded media on the backend", () => {
    expect(decide(`http://localhost:9000/static/${env}/1700-photo.png`).kind).toBe("media")
    expect(decide(`http://localhost:9000/static/${env}/1700-photo.png`, "POST").kind).toBe("abort")
  })
})

describe("rate-limit responses (M3-T14)", () => {
  it("answers 429 with a retry hint and ignores other errors", () => {
    let status = 0
    let body: any
    const res = { status: (code: number) => ((status = code), { json: (b: unknown) => (body = b) }) }
    expect(respondRateLimited(res, new RateLimitError("designer_turn", 120))).toBe(true)
    expect(status).toBe(429)
    expect(body).toEqual({
      type: "rate_limited",
      message: "Limit reached: designer_turn",
      kind: "designer_turn",
      reason: "limit",
      retry_after_seconds: 120,
    })
    // A capture already running for the store (or the process browser cap) is "busy", not a full window.
    expect(respondRateLimited(res, new RateLimitError("screenshot", 15, "busy"))).toBe(true)
    expect(body).toEqual({ type: "rate_limited", message: "Busy: screenshot", kind: "screenshot", reason: "busy", retry_after_seconds: 15 })
    expect(respondRateLimited(res, new Error("boom"))).toBe(false)
  })
})
