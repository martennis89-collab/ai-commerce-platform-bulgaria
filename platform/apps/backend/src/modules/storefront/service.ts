import { MedusaService } from "@medusajs/framework/utils"
import { Deployment, StorefrontProject } from "./models"

class StorefrontModuleService extends MedusaService({
  StorefrontProject,
  Deployment,
}) {}

export default StorefrontModuleService
