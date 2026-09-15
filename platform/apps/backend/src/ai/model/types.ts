import type { z } from "zod"

export type ModelPurpose = "generation" | "extraction"

export type StructuredRequest<T> = {
  purpose: ModelPurpose
  /** Logical operation name, e.g. "catalogue.extract_facts" (also selects fake outputs). */
  operation: string
  system: string
  /** Untrusted merchant content is always wrapped as data inside the prompt. */
  prompt: string
  /** Structured request data (used to build the prompt, and by the fake provider). */
  input: Record<string, unknown>
  schema: z.ZodType<T>
  maxTokens?: number
  signal?: AbortSignal
}

export type ModelUsage = { input_tokens: number; output_tokens: number }

export type StructuredResult<T> = {
  output: T
  usage: ModelUsage
  provider: string
  model: string
}

export interface ModelProvider {
  readonly name: string
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>
}

/** Model output that cannot be used: refusal, truncation, or schema violation. */
export class ModelOutputError extends Error {
  readonly reason: "refusal" | "truncated" | "invalid_output"

  constructor(reason: "refusal" | "truncated" | "invalid_output", detail: string) {
    super(`Model output rejected (${reason}): ${detail}`)
    this.name = "ModelOutputError"
    this.reason = reason
  }
}

/** Transient provider failure (rate limit, network, 5xx). Retryable. */
export class ModelTransientError extends Error {
  constructor(detail: string) {
    super(`Model provider temporarily unavailable: ${detail}`)
    this.name = "ModelTransientError"
  }
}
