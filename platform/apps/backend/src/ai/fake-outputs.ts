/**
 * Deterministic outputs for the fake model provider. Bulgarian, calm, and built
 * only from the merchant's own input — the same rules the real model must follow.
 */
import { createHash } from "crypto"
import { registerFakeGenerator } from "./model/fake"

type MerchantFacts = {
  business_name?: string
  location?: string
  products?: { name: string; price_eur?: number; description?: string }[]
}

const PALETTES = [
  { paper: "#fbfbf9", ink: "#17191c", muted: "#545a63", accent: "#24594a", accent_ink: "#ffffff", line: "#e3e4df" },
  { paper: "#fcfbf8", ink: "#1c1a17", muted: "#5b554c", accent: "#7a3b2e", accent_ink: "#ffffff", line: "#e7e2d9" },
  { paper: "#fafbfc", ink: "#15181d", muted: "#50596a", accent: "#2b4c7e", accent_ink: "#ffffff", line: "#e1e5ea" },
]

const firstSentence = (text: string, max: number) => {
  const sentence = (text.split(/(?<=[.!?])\s+/)[0] ?? "").trim()
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + "…" : sentence
}

registerFakeGenerator("facts.extract", (input) => {
  const facts = (input.facts ?? {}) as MerchantFacts
  const products = (facts.products ?? []).map((p) => ({
    name: p.name,
    stated_price_eur: p.price_eur ?? null,
    stated_details: p.description ?? null,
  }))
  return {
    business_name: facts.business_name ?? null,
    location: facts.location ?? null,
    products,
  }
})

registerFakeGenerator("brand.generate", (input) => {
  const name = String(input.store_name ?? "")
  const index = createHash("sha256").update(name).digest()[0] % PALETTES.length
  const description = String(input.description ?? "")
  return {
    tagline: firstSentence(description, 160) || `${name} — онлайн магазин`,
    tone: "calm",
    typography: index === 2 ? "modern" : "editorial",
    corner: "soft",
    colors: PALETTES[index],
  }
})

registerFakeGenerator("catalogue.draft_copy", (input) => {
  const products = (input.products ?? []) as { name: string; details: string | null }[]
  return {
    drafts: products.map((p, i) => ({
      source_index: i,
      title: p.name.slice(0, 80),
      description: (p.details ?? "").slice(0, 600),
    })),
  }
})

registerFakeGenerator("storefront.home_copy", (input) => {
  const name = String(input.store_name ?? "")
  const description = String(input.description ?? "")
  const instruction = input.instruction ? String(input.instruction) : ""
  return {
    hero_headline: name.slice(0, 60),
    hero_subheadline: (instruction ? firstSentence(instruction, 160) : String(input.tagline ?? "")).slice(0, 160),
    about_title: "За нас",
    about_body: description.slice(0, 800),
  }
})

registerFakeGenerator("offers.suggest", (input) => {
  const products = (input.products ?? []) as { title: string }[]
  if (products.length < 2) {
    return { offers: [] }
  }
  return {
    offers: [
      {
        title: "Комплект от два продукта",
        description: "Предложение за комплект, което можете да прегледате и настроите преди публикуване.",
        kind: "bundle",
        suggested_percent: 10,
        rationale: `Имате ${products.length} продукта, които могат да се предлагат заедно.`,
      },
    ],
  }
})

registerFakeGenerator("followup.route", (input) => {
  const prompt = String(input.prompt ?? "")
  const lower = prompt.toLowerCase()
  const targets = new Set<string>()
  if (/цвят|цветове|стил|бранд|шрифт/.test(lower)) targets.add("brand")
  if (/продукт|описани|каталог|цен|наличност/.test(lower)) targets.add("unsupported")
  if (/начал|заглав|текст|страниц|за нас/.test(lower)) targets.add("storefront")
  if (/оферт|отстъп|промо/.test(lower)) targets.add("offers")
  if (!targets.size) targets.add("storefront")
  return { targets: [...targets], instruction: prompt.slice(0, 500) || "Обнови съдържанието." }
})
