/**
 * Dedicated worker process (D3): `npx medusa exec ./src/scripts/ai-worker.ts`.
 * Loops over the same durable lanes as the scheduled job until SIGINT/SIGTERM.
 * Safe to run several copies: work is claimed through Postgres leases.
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { drainTasks, sweepExpired } from "../ai/worker"
import { drainDeployments } from "../storefront/deployments"

export default async function aiWorker({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const workerId = process.env.AI_WORKER_ID || `worker-${process.pid}`
  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  logger.info(`Amboras durable worker ${workerId} started`)
  while (!stopping) {
    await sweepExpired(container)
    await drainDeployments(container, { budgetMs: 5_000 })
    await drainTasks(container, { workerId, budgetMs: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  logger.info(`Amboras durable worker ${workerId} stopped`)
}
