/**
 * Strict contracts for everything a model may return. Each schema is enforced
 * by the provider (structured outputs) and re-validated server-side before any
 * tool sees it. None of them has fields for tenant identity, stock, publishing,
 * or arbitrary ids; product prices never come from generation output.
 */
import { z } from "zod"
import {
  AddSectionInput,
  AttachPhotoInput,
  RemoveSectionInput,
  ReorderInput,
  SetVariantInput,
  ThemeTokensInput,
  UpdateCopyInput,
} from "../designer/operations"

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const FactsExtractionSchema = z.strictObject({
  business_name: z.string().max(80).nullable(),
  location: z.string().max(80).nullable(),
  products: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(80),
        /** Only a price the merchant literally stated; verified again by priceStatedByMerchant. */
        stated_price_eur: z.number().positive().max(100000).nullable(),
        stated_details: z.string().max(400).nullable(),
      })
    )
    .max(50),
})
export type FactsExtraction = z.infer<typeof FactsExtractionSchema>

export const BrandProposalSchema = z.strictObject({
  tagline: z.string().min(1).max(160),
  tone: z.enum(["calm", "warm", "refined", "playful"]),
  typography: z.enum(["editorial", "modern"]),
  corner: z.enum(["soft", "square"]),
  colors: z.strictObject({
    paper: hex,
    ink: hex,
    muted: hex,
    accent: hex,
    accent_ink: hex,
    line: hex,
  }),
})
export type BrandProposal = z.infer<typeof BrandProposalSchema>

export const DraftCopySchema = z.strictObject({
  drafts: z
    .array(
      z.strictObject({
        source_index: z.number().int().min(0).max(49),
        title: z.string().min(1).max(80),
        description: z.string().max(600),
      })
    )
    .max(50),
})
export type DraftCopy = z.infer<typeof DraftCopySchema>

export const HomeCopySchema = z.strictObject({
  hero_headline: z.string().min(1).max(60),
  hero_subheadline: z.string().max(160),
  about_title: z.string().min(1).max(40),
  about_body: z.string().max(800),
})
export type HomeCopy = z.infer<typeof HomeCopySchema>

export const OfferSuggestionSchema = z.strictObject({
  title: z.string().min(1).max(80),
  description: z.string().max(300),
  kind: z.enum(["bundle", "free_shipping_threshold", "launch_percentage", "seasonal"]),
  suggested_percent: z.number().int().min(5).max(30).nullable(),
  rationale: z.string().max(300),
})

export const OffersSchema = z.strictObject({
  offers: z.array(OfferSuggestionSchema).max(3),
})
export type Offers = z.infer<typeof OffersSchema>

/**
 * Follow-ups may change the brand, the home page copy and offer suggestions.
 * Product drafts are merchant-edited (M3); such requests route to `unsupported`.
 */
export const FOLLOW_UP_TARGETS = ["brand", "storefront", "offers", "unsupported"] as const

export const FollowUpRouteSchema = z.strictObject({
  targets: z.array(z.enum(FOLLOW_UP_TARGETS)).min(1).max(4),
  instruction: z.string().min(1).max(500),
})
export type FollowUpRoute = z.infer<typeof FollowUpRouteSchema>

/**
 * One designer turn (M3): a short Bulgarian reply plus at most four typed
 * operations. Operation names are the AI tool names; every operation is still
 * validated, audited and executed server-side by its tool.
 */
export const DesignerOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("theme.update_tokens"), args: ThemeTokensInput }),
  z.strictObject({ op: z.literal("section.update_copy"), args: UpdateCopyInput }),
  z.strictObject({ op: z.literal("section.reorder"), args: ReorderInput }),
  z.strictObject({ op: z.literal("section.set_variant"), args: SetVariantInput }),
  z.strictObject({ op: z.literal("section.add"), args: AddSectionInput }),
  z.strictObject({ op: z.literal("section.remove"), args: RemoveSectionInput }),
  z.strictObject({ op: z.literal("section.attach_photo"), args: AttachPhotoInput }),
  z.strictObject({ op: z.literal("storefront.promote_preview"), args: z.strictObject({}) }),
])

export const DesignerPlanSchema = z.strictObject({
  reply: z.string().min(1).max(600),
  operations: z.array(DesignerOperationSchema).max(4),
})
export type DesignerPlan = z.infer<typeof DesignerPlanSchema>

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * True only when the merchant literally wrote this amount (e.g. "12", "12.50",
 * "12,50") in their description or typed facts. Guards against invented prices,
 * whatever the model claims.
 */
export function priceStatedByMerchant(price: number, merchantText: string): boolean {
  if (!Number.isFinite(price) || price <= 0) {
    return false
  }
  const forms = new Set<string>([
    price.toFixed(2),
    price.toFixed(2).replace(".", ","),
    String(price),
    String(price).replace(".", ","),
  ])
  // A whole number token ("18" not inside "118", "18.5" or "18,50") ...
  const amount = `(?:${[...forms].map(escapeRegex).join("|")})(?![.,]?[0-9])`
  // ... that is marked as a EUR price, or is a typed `price_eur` fact. "900 г" or "18 лв" never count.
  return [
    new RegExp(`(^|[^0-9.,])${amount}\\s*(€|евро|eur(?![a-z])|euro)`, "iu"),
    new RegExp(`(€|(^|[^a-z])eur)\\s*${amount}`, "iu"),
    new RegExp(`"price_eur"\\s*:\\s*${amount}`),
  ].some((pattern) => pattern.test(merchantText))
}
