import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listRunGenerations } from "../../../../../../ai/runs"
import { executionContextOf } from "../../../context"

/** Generated drafts, suggestions and applied config, with provenance, for the caller's own run. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ generations: await listRunGenerations(executionContextOf(req), req.params.id) })
}
