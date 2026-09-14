import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import { commerceFor } from "../../../../tenancy/merchant-guard"

const UpdateProduct = z
  .object({ title: z.string().min(1).optional(), status: z.enum(["draft", "published"]).optional() })
  .strict()

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ product: await commerceFor(req).getProduct(req.params.id) })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = UpdateProduct.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid product update")
  }
  res.json({ product: await commerceFor(req).updateProduct(req.params.id, parsed.data) })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json(await commerceFor(req).archiveProduct(req.params.id))
}
