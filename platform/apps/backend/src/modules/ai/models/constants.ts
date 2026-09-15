export const RUN_STATUSES = ["queued", "running", "waiting", "paused", "completed", "failed", "cancelled"] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_KINDS = ["initial_generation", "designer_edit"] as const
export type RunKind = (typeof RUN_KINDS)[number]

export const TASK_KEYS = ["brand", "catalogue", "images", "storefront", "offers", "designer"] as const
export type TaskKey = (typeof TASK_KEYS)[number]

export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled"]
