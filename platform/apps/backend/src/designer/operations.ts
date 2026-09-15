/**
 * Designer operations (M3, DESIGN.md §4.3): the only ways a storefront draft
 * can change through the contextual designer. Each operation is a pure,
 * bounded transform of a validated storefront-schema v3 config plus a short
 * Bulgarian summary. The result is re-validated by the schema before any
 * revision is committed, so an operation can never produce an invalid,
 * unreadable or out-of-library storefront.
 */
import { z } from "zod"
import {
  MEDIA_ID_RE,
  nextSectionId,
  SECTION_ID_RE,
  SECTION_VARIANTS,
  sectionLabel,
  StorefrontConfig,
} from "@platform/storefront-schema"

export class DesignerOperationError extends Error {
  readonly code: string

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`)
    this.name = "DesignerOperationError"
    this.code = code
  }
}

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const sectionIdInput = z.string().regex(SECTION_ID_RE)
const mediaIdInput = z.string().regex(MEDIA_ID_RE)

export const ThemeTokensInput = z.strictObject({
  typography: z.enum(["editorial", "modern"]).nullable(),
  corner: z.enum(["soft", "square"]).nullable(),
  colors: z
    .strictObject({
      paper: hexColour.nullable(),
      ink: hexColour.nullable(),
      muted: hexColour.nullable(),
      accent: hexColour.nullable(),
      accent_ink: hexColour.nullable(),
      line: hexColour.nullable(),
    })
    .nullable(),
})

export const COPY_FIELDS = [
  "headline",
  "subheadline",
  "cta_label",
  "title",
  "empty_state",
  "body",
  "alt",
  "caption",
  "text",
  "question",
  "answer",
] as const

export const UpdateCopyInput = z.strictObject({
  section_id: sectionIdInput,
  field: z.enum(COPY_FIELDS),
  item_index: z.number().int().min(0).max(5).nullable(),
  value: z.string().max(800),
})

export const ReorderInput = z.strictObject({
  order: z.array(sectionIdInput).min(2).max(8),
})

const ALL_VARIANTS = ["text", "image", "list", "columns", "grid", "compact", "full", "contained", "details"] as const

export const SetVariantInput = z.strictObject({
  section_id: sectionIdInput,
  variant: z.enum(ALL_VARIANTS),
})

export const ADDABLE_SECTION_TYPES = ["highlights", "image_banner", "about", "faq"] as const

export const AddSectionInput = z.strictObject({
  type: z.enum(ADDABLE_SECTION_TYPES),
  after_section_id: sectionIdInput,
  title: z.string().max(120).nullable(),
  text: z.string().max(800).nullable(),
  items: z
    .array(z.strictObject({ title: z.string().max(120), text: z.string().max(400) }))
    .max(6)
    .nullable(),
  media_id: mediaIdInput.nullable(),
})

export const RemoveSectionInput = z.strictObject({ section_id: sectionIdInput })

export const AttachPhotoInput = z.strictObject({ section_id: sectionIdInput, media_id: mediaIdInput })

export type OperationResult = { config: StorefrontConfig; summary: string }

const clone = (config: StorefrontConfig): StorefrontConfig => JSON.parse(JSON.stringify(config))

function sectionIndex(config: StorefrontConfig, id: string): number {
  const index = config.home.sections.findIndex((s) => s.id === id)
  if (index < 0) {
    throw new DesignerOperationError("unknown_section", `no section ${id} in the draft`)
  }
  return index
}

const FIELD_LABELS: Record<string, string> = {
  headline: "заглавието",
  subheadline: "подзаглавието",
  cta_label: "текста на бутона",
  title: "заглавието на секцията",
  empty_state: "текста без продукти",
  body: "текста",
  alt: "описанието на снимката",
  caption: "надписа",
  text: "текста на акцента",
  question: "въпроса",
  answer: "отговора",
}

export function applyThemeTokens(config: StorefrontConfig, input: z.infer<typeof ThemeTokensInput>): OperationResult {
  const next = clone(config)
  const changed: string[] = []
  if (input.typography && input.typography !== next.theme.typography) {
    next.theme.typography = input.typography
    changed.push("шрифта")
  }
  if (input.corner && input.corner !== next.theme.corner) {
    next.theme.corner = input.corner
    changed.push("ъглите")
  }
  if (input.colors) {
    let colours = false
    for (const [key, value] of Object.entries(input.colors)) {
      if (value && (next.theme.colors as Record<string, string>)[key] !== value.toLowerCase()) {
        ;(next.theme.colors as Record<string, string>)[key] = value.toLowerCase()
        colours = true
      }
    }
    if (colours) {
      changed.push("цветовете")
    }
  }
  if (!changed.length) {
    throw new DesignerOperationError("no_change", "the theme already has these values")
  }
  return { config: next, summary: `Промених ${changed.join(" и ")}` }
}

export function applyCopy(config: StorefrontConfig, input: z.infer<typeof UpdateCopyInput>): OperationResult {
  const next = clone(config)
  const section = next.home.sections[sectionIndex(next, input.section_id)] as Record<string, any>
  const itemFields: Record<string, string[]> = { highlights: ["title", "text"], faq: ["question", "answer"] }
  const topFields: Record<string, string[]> = {
    hero: ["headline", "subheadline", "cta_label"],
    highlights: ["title"],
    product_grid: ["title", "empty_state"],
    image_banner: ["alt", "caption"],
    about: ["title", "body"],
    faq: ["title"],
  }
  if (input.item_index === null) {
    if (!topFields[section.type]?.includes(input.field)) {
      throw new DesignerOperationError("unknown_field", `${section.type} has no editable field ${input.field}`)
    }
    section[input.field] = input.value
  } else {
    if (!itemFields[section.type]?.includes(input.field)) {
      throw new DesignerOperationError("unknown_field", `${section.type} items have no field ${input.field}`)
    }
    const item = section.items?.[input.item_index]
    if (!item) {
      throw new DesignerOperationError("unknown_item", `${section.type} has no item ${input.item_index + 1}`)
    }
    item[input.field] = input.value
  }
  return { config: next, summary: `Промених ${FIELD_LABELS[input.field] ?? "текста"} в „${sectionLabel(section.type)}“` }
}

export function applyReorder(config: StorefrontConfig, input: z.infer<typeof ReorderInput>): OperationResult {
  const current = config.home.sections.map((s) => s.id)
  const order = input.order
  if (order.length !== current.length || new Set(order).size !== order.length || order.some((id) => !current.includes(id))) {
    throw new DesignerOperationError("invalid_order", "the new order must list every existing section exactly once")
  }
  if (order.every((id, i) => id === current[i])) {
    throw new DesignerOperationError("no_change", "the sections are already in this order")
  }
  const next = clone(config)
  next.home.sections = order.map((id) => next.home.sections.find((s) => s.id === id)!) as any
  return { config: next, summary: "Промених реда на секциите" }
}

export function applyVariant(config: StorefrontConfig, input: z.infer<typeof SetVariantInput>): OperationResult {
  const next = clone(config)
  const section = next.home.sections[sectionIndex(next, input.section_id)] as Record<string, any>
  const allowed = SECTION_VARIANTS[section.type as keyof typeof SECTION_VARIANTS] as readonly string[]
  if (!allowed.includes(input.variant)) {
    throw new DesignerOperationError("unknown_variant", `${section.type} has no variant ${input.variant}`)
  }
  if (section.variant === input.variant) {
    throw new DesignerOperationError("no_change", "the section already uses this layout")
  }
  section.variant = input.variant
  return { config: next, summary: `Смених оформлението на „${sectionLabel(section.type)}“` }
}

export function applyAddSection(config: StorefrontConfig, input: z.infer<typeof AddSectionInput>): OperationResult {
  const next = clone(config)
  const after = sectionIndex(next, input.after_section_id)
  const id = nextSectionId(next, input.type)
  const title = (input.title ?? "").trim()
  let section: Record<string, unknown>
  switch (input.type) {
    case "highlights":
      section = {
        id,
        type: "highlights",
        variant: "list",
        title,
        items: (input.items ?? []).map((i) => ({ title: i.title, text: i.text })),
      }
      break
    case "faq":
      section = {
        id,
        type: "faq",
        variant: "list",
        title,
        items: (input.items ?? []).map((i) => ({ question: i.title, answer: i.text })),
      }
      break
    case "about":
      section = {
        id,
        type: "about",
        variant: input.media_id ? "image" : "text",
        title,
        body: input.text ?? "",
        image: input.media_id ? { media_id: input.media_id } : null,
      }
      break
    case "image_banner":
      if (!input.media_id) {
        throw new DesignerOperationError("photo_required", "an image banner needs one of the store's photos")
      }
      section = {
        id,
        type: "image_banner",
        variant: "contained",
        image: { media_id: input.media_id },
        alt: title,
        caption: input.text ?? "",
      }
      break
  }
  next.home.sections.splice(after + 1, 0, section as any)
  return { config: next, summary: `Добавих секция „${sectionLabel(input.type)}“` }
}

export function applyRemoveSection(config: StorefrontConfig, input: z.infer<typeof RemoveSectionInput>): OperationResult {
  const next = clone(config)
  const index = sectionIndex(next, input.section_id)
  const [removed] = next.home.sections.splice(index, 1)
  return { config: next, summary: `Премахнах секция „${sectionLabel(removed.type)}“` }
}

export function applyAttachPhoto(config: StorefrontConfig, input: z.infer<typeof AttachPhotoInput>): OperationResult {
  const next = clone(config)
  const section = next.home.sections[sectionIndex(next, input.section_id)] as Record<string, any>
  if (!["hero", "about", "image_banner"].includes(section.type)) {
    throw new DesignerOperationError("no_photo_slot", `${section.type} cannot hold a photo`)
  }
  section.image = { media_id: input.media_id }
  if (section.type !== "image_banner") {
    section.variant = "image"
  }
  return { config: next, summary: `Добавих снимка в „${sectionLabel(section.type)}“` }
}
