/**
 * Per-store rolling limits for the actions M3 makes cheap to trigger
 * (M3-D11): storefront edits, designer turns, preview deployments and
 * screenshots. Limits are server configuration; counts come from the audited
 * rows themselves, so there is no separate counter that could drift.
 *
 * The check is soft under exact concurrency (two requests at the boundary can
 * both pass); every counted action is itself bounded and audited.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export type RateLimitKind = "designer_edit" | "designer_turn" | "preview_deploy" | "screenshot"

const WINDOW_SECONDS = 3600

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export function rateLimitConfig(): Record<RateLimitKind, number> {
  return {
    designer_edit: intEnv("DESIGNER_MAX_EDITS_PER_HOUR", 120, 1, 10_000),
    designer_turn: intEnv("DESIGNER_MAX_TURNS_PER_HOUR", 60, 1, 10_000),
    preview_deploy: intEnv("STOREFRONT_MAX_PREVIEW_DEPLOYS_PER_HOUR", 20, 1, 1_000),
    screenshot: intEnv("STOREFRONT_MAX_SCREENSHOTS_PER_HOUR", 20, 1, 1_000),
  }
}

export class RateLimitError extends MedusaError {
  readonly kind: RateLimitKind
  readonly retryAfterSeconds: number

  constructor(kind: RateLimitKind, retryAfterSeconds: number) {
    super(MedusaError.Types.NOT_ALLOWED, `Limit reached: ${kind}`)
    this.name = "RateLimitError"
    this.kind = kind
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const COUNT_SQL: Record<RateLimitKind, string> = {
  designer_edit: `SELECT count(*)::int AS n, min(created_at) AS oldest FROM storefront_revision
    WHERE store_environment_id = ? AND author_type IN ('merchant', 'ai') AND deleted_at IS NULL
      AND created_at > now() - (? * interval '1 second')`,
  designer_turn: `SELECT count(*)::int AS n, min(created_at) AS oldest FROM ai_designer_message
    WHERE store_environment_id = ? AND role = 'merchant' AND deleted_at IS NULL
      AND created_at > now() - (? * interval '1 second')`,
  preview_deploy: `SELECT count(*)::int AS n, min(created_at) AS oldest FROM storefront_deployment
    WHERE store_environment_id = ? AND target = 'preview' AND deleted_at IS NULL
      AND created_at > now() - (? * interval '1 second')`,
  screenshot: `SELECT count(*)::int AS n, min(created_at) AS oldest FROM storefront_screenshot
    WHERE store_environment_id = ? AND deleted_at IS NULL
      AND created_at > now() - (? * interval '1 second')`,
}

export async function assertWithinRateLimit(container: MedusaContainer, storeEnvironmentId: string, kind: RateLimitKind) {
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const [{ n, oldest }] = (await knex.raw(COUNT_SQL[kind], [storeEnvironmentId, WINDOW_SECONDS])).rows
  if (n >= rateLimitConfig()[kind]) {
    const reopensAt = new Date(oldest).getTime() + WINDOW_SECONDS * 1000
    throw new RateLimitError(kind, Math.max(1, Math.ceil((reopensAt - Date.now()) / 1000)))
  }
}

/** Route helper: answers 429 with a retry hint for rate-limit errors; returns false for anything else. */
export function respondRateLimited(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): boolean {
  if (error instanceof RateLimitError || (error as any)?.name === "RateLimitError") {
    const e = error as RateLimitError
    res.status(429).json({
      type: "rate_limited",
      message: e.message,
      kind: e.kind,
      retry_after_seconds: e.retryAfterSeconds,
    })
    return true
  }
  return false
}
