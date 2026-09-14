import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import { commerceFor } from "../../../../../tenancy/merchant-guard"

const SetStock = z.object({ stocked_quantity: z.number().int().min(0) }).strict()

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    inventory_level: await commerceFor(req).getInventoryLevel(
      req.params.inventory_item_id,
      req.params.location_id
    ),
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = SetStock.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid stock update")
  }
  res.json({
    inventory_level: await commerceFor(req).setStockedQuantity(
      req.params.inventory_item_id,
      req.params.location_id,
      parsed.data.stocked_quantity
    ),
  })
}
