import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelRun } from "../../../../../../ai/runs"
import { executionContextOf } from "../../../context"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ run: await cancelRun(executionContextOf(req), req.params.id) })
}
