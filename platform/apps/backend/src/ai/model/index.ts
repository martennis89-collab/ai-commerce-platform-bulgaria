import { aiModelConfig } from "../config"
import "../fake-outputs"
import { AnthropicModelProvider } from "./anthropic"
import { FakeModelProvider } from "./fake"
import type { ModelProvider } from "./types"

export * from "./types"

let anthropic: AnthropicModelProvider | undefined
const fake = new FakeModelProvider()

/** Provider selection is server configuration (AI_MODEL_PROVIDER); the default is the deterministic fake. */
export function getModelProvider(): ModelProvider {
  if (aiModelConfig().provider === "anthropic") {
    anthropic ??= new AnthropicModelProvider()
    return anthropic
  }
  return fake
}
