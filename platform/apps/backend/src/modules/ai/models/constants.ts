export const RUN_STATUSES = ["queued", "running", "waiting", "paused", "completed", "failed", "cancelled"] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const TASK_KEYS = ["brand", "catalogue", "images", "storefront", "offers"] as const
export type TaskKey = (typeof TASK_KEYS)[number]

export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled"]
