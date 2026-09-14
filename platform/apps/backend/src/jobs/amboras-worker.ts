/**
 * Same-backend worker (D3, Level 3 §2): Medusa runs scheduled jobs only in the
 * `shared` and `worker` modes, so this is the deployment-mode worker. Each tick
 * recovers expired leases, drains storefront deployments, then drains AI tasks
 * and follow-up prompts. Overlapping ticks are forbidden; leases make
 * concurrent workers (several processes) safe regardless.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { aiWorkerConfig } from "../ai/config"
import { drainTasks, sweepExpired } from "../ai/worker"
import { drainDeployments } from "../storefront/deployments"

export default async function amborasWorker(container: MedusaContainer) {
  const config = aiWorkerConfig()
  if (!config.autostart) {
    return
  }
  await sweepExpired(container)
  await drainDeployments(container, { budgetMs: Math.floor(config.drainBudgetMs / 2) })
  await drainTasks(container, { budgetMs: config.drainBudgetMs })
}

export const config = {
  name: "amboras-durable-worker",
  schedule: { interval: 2000, concurrency: "forbid" },
}
