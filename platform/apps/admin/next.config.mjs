/**
 * Amboras admin (M3-D2/D3).
 * - The shared storefront renderer and schema are consumed from the workspace.
 * - Framing: only the same-origin draft frame (/frame) may be framed, and only by
 *   the admin itself; every other page refuses framing (clickjacking).
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@platform/storefront-core", "@platform/storefront-schema"],
  ...(process.env.ADMIN_TURBOPACK_ROOT ? { turbopack: { root: process.env.ADMIN_TURBOPACK_ROOT } } : {}),
  async headers() {
    const common = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ]
    return [
      {
        source: "/frame",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          ...common,
        ],
      },
      {
        source: "/((?!frame$).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          ...common,
        ],
      },
    ]
  },
}

export default nextConfig
