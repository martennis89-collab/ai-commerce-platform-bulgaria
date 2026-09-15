/**
 * The single definition of "newest deployment" (M3-D11, closes review N-a):
 * the monotonic per-project request sequence decides, and rows created before
 * sequences existed sort last. The id is only a final tie-breaker.
 */
export const NEWEST_DEPLOYMENT_ORDER = "sequence DESC NULLS LAST, id DESC"
