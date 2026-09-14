import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getRunSummary } from "../../../../../ai/runs"
import { executionContextOf } from "../../context"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ run: await getRunSummary(executionContextOf(req), req.params.id) })
}
