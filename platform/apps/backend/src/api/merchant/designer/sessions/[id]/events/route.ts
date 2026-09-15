import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sqlRows } from "../../../../../../ai/sql"
import { designerFor, executionContextOf } from "../../../context"

const POLL_MS = 1000
const MAX_STREAM_MS = 10 * 60 * 1000

/**
 * Live designer state as server-sent events. Every poll re-reads through the
 * caller's own StoreEnvironment: session messages plus a small head/preview
 * signature. The client refetches `GET /merchant/designer` when the signature
 * changes. A foreign session id is rejected before any stream bytes are sent.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ctx = executionContextOf(req)
  const designer = designerFor(req)
  const sessionId = req.params.id
  const snapshot = async () => {
    const session = await designer.getSession(sessionId)
    const [project] = await sqlRows(
      ctx.scope.container,
      `SELECT head_revision_id, preview_revision_id, revision_sequence, deployment_sequence FROM storefront_project
        WHERE store_environment_id = ? AND status = 'active' AND deleted_at IS NULL`,
      [ctx.scope.storeEnvironmentId]
    )
    const [deployment] = await sqlRows(
      ctx.scope.container,
      `SELECT id, status FROM storefront_deployment WHERE store_environment_id = ? AND target = 'preview' AND deleted_at IS NULL
        ORDER BY sequence DESC NULLS LAST, id DESC LIMIT 1`,
      [ctx.scope.storeEnvironmentId]
    )
    const [screenshots] = await sqlRows(
      ctx.scope.container,
      `SELECT count(*)::int AS n FROM storefront_screenshot WHERE store_environment_id = ? AND deleted_at IS NULL`,
      [ctx.scope.storeEnvironmentId]
    )
    return {
      messages: session.messages,
      signature: {
        head_revision_id: project?.head_revision_id ?? null,
        preview_revision_id: project?.preview_revision_id ?? null,
        latest_deployment: deployment ? { id: deployment.id, status: deployment.status } : null,
        screenshots: screenshots?.n ?? 0,
      },
    }
  }

  const first = await snapshot()
  res.status(200)
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  ;(res as any).flushHeaders?.()

  let closed = false
  req.on("close", () => {
    closed = true
  })
  const send = (data: unknown) => res.write(`event: designer\ndata: ${JSON.stringify(data)}\n\n`)

  let last = JSON.stringify(first)
  send(first)
  const startedAt = Date.now()
  while (!closed && Date.now() - startedAt < MAX_STREAM_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    let next
    try {
      next = await snapshot()
    } catch {
      break
    }
    const serialized = JSON.stringify(next)
    if (serialized !== last) {
      last = serialized
      send(next)
    } else {
      res.write(`: keep-alive\n\n`)
    }
  }
  if (!closed) {
    res.write(`event: end\ndata: {}\n\n`)
    res.end()
  }
}
