import { MedusaService } from "@medusajs/framework/utils"
import { Deployment, StorefrontProject, StorefrontRevision, StorefrontScreenshot } from "./models"

class StorefrontModuleService extends MedusaService({
  StorefrontProject,
  Deployment,
  StorefrontRevision,
  StorefrontScreenshot,
}) {}

export default StorefrontModuleService
