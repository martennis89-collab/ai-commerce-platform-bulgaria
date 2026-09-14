import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { enqueueFollowUp } from "../../../../../../ai/runs"
import { executionContextOf } from "../../../context"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.status(202).json({ run: await enqueueFollowUp(executionContextOf(req), req.params.id, req.body ?? {}) })
}
