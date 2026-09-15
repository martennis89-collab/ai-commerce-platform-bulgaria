import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listRunSummaries, startInitialGeneration } from "../../../../ai/runs"
import { executionContextOf } from "../context"

/** Start an initial generation for the caller's own StoreEnvironment. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.status(202).json({ run: await startInitialGeneration(executionContextOf(req), req.body ?? {}) })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ runs: await listRunSummaries(executionContextOf(req)) })
}
