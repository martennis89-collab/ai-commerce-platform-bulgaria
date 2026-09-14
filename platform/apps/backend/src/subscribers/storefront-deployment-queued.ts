import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { executeDeployment, STOREFRONT_DEPLOYMENT_QUEUED } from "../storefront/deployments"

export default async function storefrontDeploymentQueued({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  await executeDeployment(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: STOREFRONT_DEPLOYMENT_QUEUED,
}
