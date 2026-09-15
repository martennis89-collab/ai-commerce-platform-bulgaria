import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/** Raw Postgres access for lease/fencing statements that need atomic conditional updates. */
export async function sqlRows<T = any>(
  container: MedusaContainer,
  sql: string,
  bindings: unknown[] = []
): Promise<T[]> {
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const result = await knex.raw(sql, bindings)
  return (result?.rows ?? []) as T[]
}
