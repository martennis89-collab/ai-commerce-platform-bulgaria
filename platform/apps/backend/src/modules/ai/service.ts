import { MedusaService } from "@medusajs/framework/utils"
import {
  AgentRun,
  AgentTask,
  AIAction,
  BusinessProfile,
  DesignerMessage,
  DesignerSession,
  Generation,
  MediaAsset,
  PromptQueueItem,
} from "./models"

class AiModuleService extends MedusaService({
  AgentRun,
  AgentTask,
  PromptQueueItem,
  AIAction,
  Generation,
  BusinessProfile,
  MediaAsset,
  DesignerSession,
  DesignerMessage,
}) {}

export default AiModuleService
