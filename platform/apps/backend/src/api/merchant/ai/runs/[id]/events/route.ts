import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getRunSummary } from "../../../../../../ai/runs"
import { TERMINAL_STATUSES } from "../../../../../../modules/ai/models"
import { executionContextOf } from "../../../context"

const POLL_MS = 1000
const MAX_STREAM_MS = 10 * 60 * 1000

/**
 * Live run status as server-sent events (D5). The run is loaded through the
 * tenant-scoped summary on every poll, so a foreign or deleted run ends the
 * stream. Emits `run` events on change and closes on a terminal status.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ctx = executionContextOf(req)
  const runId = req.params.id
  const first = await getRunSummary(ctx, runId) // 404s before any stream bytes for foreign ids

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
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  let last = JSON.stringify(first)
  send("run", first)
  const startedAt = Date.now()
  while (!closed && !TERMINAL_STATUSES.includes(JSON.parse(last).status) && Date.now() - startedAt < MAX_STREAM_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    let summary
    try {
      summary = await getRunSummary(ctx, runId)
    } catch {
      break
    }
    const serialized = JSON.stringify(summary)
    if (serialized !== last) {
      last = serialized
      send("run", summary)
    } else {
      res.write(`: keep-alive\n\n`)
    }
  }
  if (!closed) {
    send("end", { status: JSON.parse(last).status })
    res.end()
  }
}
