import type { DeploymentManifest } from "@platform/storefront-core"
import type { StorefrontDeployProvider } from "./provider"

/**
 * Validates and records the manifest (the Deployment row keeps the snapshot)
 * without building. Used by fast integration tests and for configuration checks.
 */
export const dryRunProvider: StorefrontDeployProvider = {
  name: "dry-run",
  async deploy(manifest: DeploymentManifest) {
    return {
      artifact_ref: `dry-run/${manifest.deployment_id}`,
      url: `http://${manifest.hostname}/`,
    }
  },
}
