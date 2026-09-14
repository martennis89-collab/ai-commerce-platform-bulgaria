/** Error taxonomy for durable AI execution. */

/** The worker no longer holds the task lease (expired and re-claimed elsewhere). Stop silently. */
export class LeaseLostError extends Error {
  constructor() {
    super("Task lease lost")
    this.name = "LeaseLostError"
  }
}

/** The run was cancelled or paused; stop at the checkpoint. */
export class TaskAbortedError extends Error {
  readonly reason: "cancelled" | "paused"

  constructor(reason: "cancelled" | "paused") {
    super(`Task ${reason}`)
    this.name = "TaskAbortedError"
    this.reason = reason
  }
}

export type ToolRejectionCode = "tenant_selector" | "invalid_input" | "risk" | "policy" | "limit"

/** A tool call was refused before any side effect. Never retried as-is. */
export class ToolRejectedError extends Error {
  readonly code: ToolRejectionCode

  constructor(code: ToolRejectionCode, detail: string) {
    super(`Tool call rejected (${code}): ${detail}`)
    this.name = "ToolRejectedError"
    this.code = code
  }
}

/** A configured run/task limit was reached (D8). Not retryable. */
export class LimitReachedError extends Error {
  constructor(detail: string) {
    super(`Limit reached: ${detail}`)
    this.name = "LimitReachedError"
  }
}

/** Stable, non-sensitive error codes exposed to merchants. */
export type MerchantErrorCode =
  | "model_unavailable"
  | "model_output_rejected"
  | "policy_rejected"
  | "limit_reached"
  | "internal"
