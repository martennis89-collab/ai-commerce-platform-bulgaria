/**
 * Storefront core Next.js config. Local deployments are static exports: each
 * build is an independent artifact for exactly one store environment.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  ...(process.env.STOREFRONT_TURBOPACK_ROOT
    ? { turbopack: { root: process.env.STOREFRONT_TURBOPACK_ROOT } }
    : {}),
}

export default nextConfig
