import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requestPreviewDeployment } from "../../../../../../storefront/deployments"

/** Operator-only (M0 `/admin` guard): redeploy a given environment's preview. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const deployment = await requestPreviewDeployment(req.scope, req.params.id)
  res.status(202).json({ deployment: { id: deployment.id, status: deployment.status, target: deployment.target } })
}
