import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { pauseRun } from "../../../../../../ai/runs"
import { executionContextOf } from "../../../context"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ run: await pauseRun(executionContextOf(req), req.params.id) })
}
