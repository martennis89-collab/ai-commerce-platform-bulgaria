# apps/storefront — storefront-core harness

Local development and reference harness for `packages/storefront-core` and `packages/storefront-schema`.

It is **not** a shared multi-tenant storefront runtime (Level 3 §2). It renders exactly one deployment manifest, and refuses to start with zero or several. Merchant storefronts are independent `StorefrontProject` deployments built from the versioned core by a deployment provider.

```bash
npm run build:packages
npm run dev -w @platform/storefront-harness -- --manifest ./manifest.json
```
