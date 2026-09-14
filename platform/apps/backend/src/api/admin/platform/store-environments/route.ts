import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import { createStoreEnvironmentWorkflow } from "../../../../workflows/storefront/create-store-environment"

/** Operator-only (M0 `/admin` guard). */
const CreateStoreEnvironment = z.strictObject({
  handle: z.string(),
  name: z.string(),
  organization_name: z.string().optional(),
  owner_user_id: z.string().optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = CreateStoreEnvironment.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid store environment request")
  }
  const { result } = await createStoreEnvironmentWorkflow(req.scope).run({ input: parsed.data })
  const { store_environment, project, deployment } = result as any
  res.status(201).json({
    store_environment: { id: store_environment.id, handle: store_environment.handle, hostname: store_environment.hostname },
    storefront_project: {
      id: project.id,
      preview_hostname: project.preview_hostname,
      live_hostname: project.live_hostname,
      core_version: project.core_version,
    },
    deployment: { id: deployment.id, status: deployment.status, target: deployment.target },
  })
}
