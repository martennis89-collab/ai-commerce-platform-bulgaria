/**
 * Local preview gateway (ADR-017). Serves ready preview deployments built by the
 * `local` provider on `http://<handle>.preview.<platform-domain>:<PREVIEW_GATEWAY_PORT>/`.
 *
 *   npm run preview:gateway          (from platform/apps/backend)
 *
 * Binds to 127.0.0.1 by default (PREVIEW_GATEWAY_HOST to override).
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { startPreviewGateway } from "../storefront/deploy/gateway"
import { deployProviderName, localDeployRoot, previewGatewayPort } from "../storefront/platform-config"

export default async function previewGateway({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (deployProviderName() !== "local") {
    logger.warn(
      `STOREFRONT_DEPLOY_PROVIDER is "${deployProviderName()}"; only "local" deployments produce artifacts to serve`
    )
  }
  const server = await startPreviewGateway(container)
  logger.info(
    `Preview gateway serving ${localDeployRoot()} on port ${previewGatewayPort()} for *.preview hostnames`
  )
  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve())
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })
}
