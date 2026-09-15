/**
 * Anthropic provider (D1). Structured outputs via messages.parse +
 * zodOutputFormat; the result is re-validated against the same strict schema
 * before any tool sees it. Model IDs come from configuration only.
 */
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { aiModelConfig } from "../config"
import { ModelRequestError } from "../errors"
import type { ModelProvider, StructuredRequest, StructuredResult } from "./types"
import { ModelOutputError, ModelTransientError } from "./types"

export class AnthropicModelProvider implements ModelProvider {
  readonly name = "anthropic"
  readonly #client: Anthropic

  constructor(client?: Anthropic) {
    // Credentials resolve from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
    this.#client = client ?? new Anthropic({ maxRetries: 2, timeout: 5 * 60 * 1000 })
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const config = aiModelConfig()
    const model = request.purpose === "extraction" ? config.extractionModel : config.generationModel
    let response: any
    try {
      response = await this.#client.messages.parse(
        {
          model,
          max_tokens: request.maxTokens ?? config.maxOutputTokens,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          output_config: { format: zodOutputFormat(request.schema as any) },
        },
        { signal: request.signal }
      )
    } catch (error) {
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError
      ) {
        throw new ModelTransientError(error.message)
      }
      if (!(error instanceof Anthropic.APIError)) {
        // The SDK's own structured-output parsing failed: invalid output, not worth retrying.
        throw new ModelOutputError("invalid_output", String((error as Error)?.message ?? error).slice(0, 500))
      }
      if (typeof error.status === "number" && error.status >= 400 && error.status < 500 && ![408, 409].includes(error.status)) {
        // Bad request, authentication, permission, not found, too large: retrying cannot help.
        throw new ModelRequestError(error.status, error.message)
      }
      throw error
    }

    if (response.stop_reason === "refusal") {
      throw new ModelOutputError("refusal", "the model declined the request")
    }
    if (response.stop_reason === "max_tokens") {
      throw new ModelOutputError("truncated", "output hit max_tokens")
    }
    const parsed = request.schema.safeParse(response.parsed_output)
    if (!parsed.success) {
      throw new ModelOutputError(
        "invalid_output",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      )
    }
    return {
      output: parsed.data,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      provider: "anthropic",
      model,
    }
  }
}
