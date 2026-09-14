/**
 * Client-controlled inputs that attempt to select a tenant.
 *
 * Tenant identity is always derived server-side. Any request or tool call that
 * even tries to name a tenant is rejected outright (not silently ignored), so a
 * spoofing attempt is visible and can never be half-honoured by a later layer.
 */
export const FORBIDDEN_TENANT_KEYS = new Set([
  "store_environment_id",
  "storeenvironmentid",
  "store_environment",
  "storeenvironment",
  "tenant_id",
  "tenantid",
  "tenant",
  "organization_id",
  "organizationid",
  "org_id",
])

export const FORBIDDEN_TENANT_HEADERS = [
  "x-store-environment-id",
  "x-store-environment",
  "x-tenant-id",
  "x-tenant",
  "x-organization-id",
]

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/-/g, "_")
}

export function isForbiddenTenantKey(key: string): boolean {
  const k = normalizeKey(key)
  return FORBIDDEN_TENANT_KEYS.has(k) || FORBIDDEN_TENANT_KEYS.has(k.replace(/_/g, ""))
}

/** Deep-scans a JSON-like value; returns the offending key paths. */
export function findTenantSelectors(value: unknown, path = "$", depth = 0): string[] {
  if (depth > 20 || value === null || typeof value !== "object") {
    return []
  }
  const found: string[] = []
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findTenantSelectors(v, `${path}[${i}]`, depth + 1)))
    return found
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const keyPath = `${path}.${key}`
    // query strings such as `filters[store_environment_id]=` arrive as nested keys or bracketed keys
    const bracketParts = key.split(/[\[\]]/).filter(Boolean)
    if (isForbiddenTenantKey(key) || bracketParts.some(isForbiddenTenantKey)) {
      found.push(keyPath)
    }
    found.push(...findTenantSelectors(v, keyPath, depth + 1))
  }
  return found
}

export function findTenantSelectorHeaders(headers: Record<string, unknown>): string[] {
  return FORBIDDEN_TENANT_HEADERS.filter((h) => headers[h] !== undefined)
}
