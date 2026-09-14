/**
 * Deployment provider abstraction (ADR-017). A provider receives a validated
 * manifest for exactly one project/target and returns where the artifact lives.
 * The production hosting provider is an open decision; M1 ships `dry-run` and
 * the credential-free `local` adapter.
 */
import type { DeploymentManifest } from "@platform/storefront-core"
import { deployProviderName, DeployProviderName } from "../platform-config"
import { dryRunProvider } from "./dry-run"
import { localProvider } from "./local"

export type DeployResult = {
  artifact_ref: string
  url: string
}

export interface StorefrontDeployProvider {
  readonly name: DeployProviderName
  deploy(manifest: DeploymentManifest): Promise<DeployResult>
}

export function getDeployProvider(name: DeployProviderName = deployProviderName()): StorefrontDeployProvider {
  return name === "dry-run" ? dryRunProvider : localProvider
}
