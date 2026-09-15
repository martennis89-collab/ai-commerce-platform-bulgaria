/**
 * CORS for the merchant API (M3-D3). The Amboras admin (`apps/admin`) calls
 * `/merchant/*` from its own origin with a bearer token held in memory, so only
 * exact configured origins are allowed; there are no cookies and no
 * credentialed CORS. Requests without an Origin header (server-to-server,
 * tests) are unaffected; authentication is still required by the next
 * middleware in every case.
 */
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cors = require("cors")

export function merchantCorsOrigins(): string[] {
  return (process.env.MERCHANT_CORS ?? "http://localhost:7001")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => /^https?:\/\/[^\s/]+$/.test(origin))
}

const handler = cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) =>
    callback(null, !origin || merchantCorsOrigins().includes(origin)),
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["authorization", "content-type", "x-current-page"],
  maxAge: 600,
})

export function merchantCors(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  return handler(req, res, next)
}
