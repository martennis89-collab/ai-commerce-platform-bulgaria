/**
 * Deterministic fake model provider (B1). Default outputs come from each
 * operation's registered generator over the structured request input, so the
 * same input always yields the same output. Tests can override behaviour per
 * operation; the registry lives on globalThis so the Jest module instance and the
 * app's module instance share it. Child-process workers are steered with env
 * vars (AI_FAKE_DELAY_MS, AI_FAKE_FAIL_OPERATIONS).
 */
import type { ModelProvider, StructuredRequest, StructuredResult } from "./types"
import { ModelOutputError, ModelTransientError } from "./types"

export type FakeGenerator = (
  input: Record<string, unknown>,
  request: StructuredRequest<unknown>
) => unknown | Promise<unknown>

type FakeRegistry = {
  generators: Map<string, FakeGenerator>
  overrides: Map<string, FakeGenerator>
  calls: { operation: string; input: Record<string, unknown> }[]
}

const REGISTRY_KEY = "__amboras_fake_model_registry__"

export function fakeRegistry(): FakeRegistry {
  const g = globalThis as any
  g[REGISTRY_KEY] ??= { generators: new Map(), overrides: new Map(), calls: [] }
  return g[REGISTRY_KEY]
}

export function registerFakeGenerator(operation: string, generator: FakeGenerator) {
  fakeRegistry().generators.set(operation, generator)
}

/** Test hook: replace an operation's output (adversarial or invalid output, thrown errors, delays). */
export function setFakeOverride(operation: string, generator: FakeGenerator | null) {
  if (generator) {
    fakeRegistry().overrides.set(operation, generator)
  } else {
    fakeRegistry().overrides.delete(operation)
  }
}

export function resetFakeModel() {
  const registry = fakeRegistry()
  registry.overrides.clear()
  registry.calls.length = 0
}

const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value ?? "").length / 4)

export class FakeModelProvider implements ModelProvider {
  readonly name = "fake"

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const registry = fakeRegistry()
    registry.calls.push({ operation: request.operation, input: request.input })

    const delay = Number(process.env.AI_FAKE_DELAY_MS ?? 0)
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    const failing = (process.env.AI_FAKE_FAIL_OPERATIONS ?? "").split(",").map((s) => s.trim())
    if (failing.includes(request.operation)) {
      throw new ModelTransientError(`fake failure for ${request.operation}`)
    }

    const generator = registry.overrides.get(request.operation) ?? registry.generators.get(request.operation)
    if (!generator) {
      throw new ModelOutputError("invalid_output", `no fake generator for ${request.operation}`)
    }
    const raw = await generator(request.input, request as StructuredRequest<unknown>)
    const parsed = request.schema.safeParse(raw)
    if (!parsed.success) {
      throw new ModelOutputError(
        "invalid_output",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      )
    }
    return {
      output: parsed.data,
      usage: { input_tokens: estimateTokens(request.prompt), output_tokens: estimateTokens(raw) },
      provider: "fake",
      model: "fake-deterministic",
    }
  }
}
