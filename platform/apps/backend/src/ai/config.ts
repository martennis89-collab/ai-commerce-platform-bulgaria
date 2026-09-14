/**
 * M2 AI configuration (D1, D8). Every value is server configuration from env
 * vars with conservative defaults; nothing can be set by a request or a model.
 */
export type AiProviderName = "fake" | "anthropic"

export type AiLimits = {
  maxActiveRunsPerStore: number
  maxRunsPerStorePerDay: number
  maxRunDurationMs: number
  maxTokensPerRun: number
  maxModelCallsPerRun: number
  maxToolCallsPerTask: number
  maxTaskAttempts: number
  maxProductDrafts: number
  maxPromptChars: number
  maxFollowUpsPerRun: number
  maxMediaPerRun: number
  maxUploadBytes: number
  maxAutoRisk: number
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export function aiLimits(): AiLimits {
  return {
    maxActiveRunsPerStore: intEnv("AI_MAX_ACTIVE_RUNS_PER_STORE", 1, 1, 5),
    maxRunsPerStorePerDay: intEnv("AI_MAX_RUNS_PER_STORE_PER_DAY", 5, 1, 100),
    maxRunDurationMs: intEnv("AI_MAX_RUN_DURATION_MS", 15 * 60 * 1000, 10_000, 2 * 60 * 60 * 1000),
    maxTokensPerRun: intEnv("AI_MAX_TOKENS_PER_RUN", 200_000, 1_000, 2_000_000),
    maxModelCallsPerRun: intEnv("AI_MAX_MODEL_CALLS_PER_RUN", 20, 1, 200),
    maxToolCallsPerTask: intEnv("AI_MAX_TOOL_CALLS_PER_TASK", 30, 1, 200),
    maxTaskAttempts: intEnv("AI_MAX_TASK_ATTEMPTS", 3, 1, 10),
    maxProductDrafts: intEnv("AI_MAX_PRODUCT_DRAFTS", 12, 1, 50),
    maxPromptChars: intEnv("AI_MAX_PROMPT_CHARS", 4000, 100, 20_000),
    maxFollowUpsPerRun: intEnv("AI_MAX_FOLLOWUPS_PER_RUN", 5, 0, 50),
    maxMediaPerRun: intEnv("AI_MAX_MEDIA_PER_RUN", 12, 0, 50),
    maxUploadBytes: intEnv("AI_MAX_UPLOAD_BYTES", 5 * 1024 * 1024, 1024, 20 * 1024 * 1024),
    // Level 3 §6: only risk 0 and 1 may run automatically during initial generation.
    maxAutoRisk: intEnv("AI_MAX_AUTO_RISK", 1, 0, 1),
  }
}

export type AiModelConfig = {
  provider: AiProviderName
  /** Sonnet-tier default (verified against Anthropic's Models Overview, 2026-09-14). */
  generationModel: string
  /** Haiku-tier default; Anthropic lists retirement not sooner than 2026-10-15, so keep it configurable. */
  extractionModel: string
  maxOutputTokens: number
}

export function aiModelConfig(): AiModelConfig {
  const provider: AiProviderName = process.env.AI_MODEL_PROVIDER === "anthropic" ? "anthropic" : "fake"
  return {
    provider,
    generationModel: process.env.AI_GENERATION_MODEL || "claude-sonnet-5",
    extractionModel: process.env.AI_EXTRACTION_MODEL || "claude-haiku-4-5",
    maxOutputTokens: intEnv("AI_MAX_OUTPUT_TOKENS", 8000, 256, 64_000),
  }
}

export type AiWorkerConfig = {
  /** Run the in-process task drain automatically (disable in tests that drive workers manually). */
  autostart: boolean
  leaseMs: number
  heartbeatMs: number
  concurrency: number
  drainBudgetMs: number
}

export function aiWorkerConfig(): AiWorkerConfig {
  const leaseMs = intEnv("AI_WORKER_LEASE_MS", 60_000, 200, 30 * 60 * 1000)
  return {
    autostart: process.env.AI_WORKER_AUTOSTART !== "false",
    leaseMs,
    heartbeatMs: intEnv("AI_WORKER_HEARTBEAT_MS", Math.max(100, Math.floor(leaseMs / 3)), 50, leaseMs),
    concurrency: intEnv("AI_WORKER_CONCURRENCY", 3, 1, 20),
    drainBudgetMs: intEnv("AI_WORKER_DRAIN_BUDGET_MS", 55_000, 1_000, 10 * 60 * 1000),
  }
}
