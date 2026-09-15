import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryTask } from "../../../../../../../../ai/runs"
import { executionContextOf } from "../../../../../context"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ run: await retryTask(executionContextOf(req), req.params.id, req.params.task_id) })
}
