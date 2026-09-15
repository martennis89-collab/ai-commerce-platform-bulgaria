import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resumeRun } from "../../../../../../ai/runs"
import { executionContextOf } from "../../../context"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ run: await resumeRun(executionContextOf(req), req.params.id) })
}
