/**
 * Hostname normalisation for StoreEnvironment resolution.
 *
 * Only exact matches against a registered hostname are ever accepted; there is
 * no suffix/prefix/wildcard matching, so `maria-candles.shops.test.evil.com`
 * or `evil-maria-candles.shops.test` can never resolve to Maria's environment.
 */
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/

export function normalizeHostname(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") {
    return null
  }
  let host = raw.trim().toLowerCase()
  if (!host || host.includes("/") || host.includes("@") || host.includes(",")) {
    return null
  }
  // strip port
  const portMatch = host.match(/^([^:]+):(\d{1,5})$/)
  if (portMatch) {
    host = portMatch[1]
  } else if (host.includes(":")) {
    return null
  }
  if (host.endsWith(".")) {
    host = host.slice(0, -1)
  }
  return HOSTNAME_RE.test(host) ? host : null
}
