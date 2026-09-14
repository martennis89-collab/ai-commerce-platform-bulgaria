/**
 * Storefront configuration schema.
 *
 * Storefront editing is schema-first (ADR-007): every change to a storefront is
 * a change to validated configuration that a deterministic renderer consumes.
 * Schemas are strict — unknown keys are rejected — so configuration can never
 * carry tenant selection, credentials or other out-of-band data. Tenant identity
 * and the publishable key are supplied by the server-built deployment manifest.
 */
import { z } from "zod"

/** Re-exported so dependants validate with the same zod instance. */
export { z }

export const STOREFRONT_SCHEMA_VERSION = 1 as const

export const StorefrontConfigSchema = z.strictObject({
  schema_version: z.literal(STOREFRONT_SCHEMA_VERSION),
  store: z.strictObject({
    name: z.string().trim().min(1).max(80),
    locale: z.literal("bg-BG"),
    currency_code: z.literal("eur"),
  }),
  theme: z.strictObject({
    preset: z.enum(["default"]),
  }),
})

export type StorefrontConfig = z.infer<typeof StorefrontConfigSchema>

export class StorefrontConfigError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid storefront config: ${issues.join("; ")}`)
    this.name = "StorefrontConfigError"
    this.issues = issues
  }
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`)
}

export function parseStorefrontConfig(input: unknown): StorefrontConfig {
  const result = StorefrontConfigSchema.safeParse(input)
  if (!result.success) {
    throw new StorefrontConfigError(formatIssues(result.error))
  }
  return result.data
}

export function defaultStorefrontConfig(storeName: string): StorefrontConfig {
  return parseStorefrontConfig({
    schema_version: STOREFRONT_SCHEMA_VERSION,
    store: { name: storeName, locale: "bg-BG", currency_code: "eur" },
    theme: { preset: "default" },
  })
}
