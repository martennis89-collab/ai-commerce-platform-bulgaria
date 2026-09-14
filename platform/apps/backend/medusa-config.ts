import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:9000",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
      // Guest checkout only: Medusa customer identities are global across stores.
      authMethodsPerActor: { user: ["emailpass"], customer: [] },
    },
  },
  // M0 has no merchant UI; the Medusa admin dashboard is operator tooling only and is not built.
  admin: { disable: true },
  modules: [
    {
      resolve: "./src/modules/tenancy",
    },
    {
      resolve: "./src/modules/storefront",
    },
    {
      resolve: "./src/modules/ai",
    },
  ],
})
