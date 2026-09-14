import "./globals.css"
import { getManifest } from "../lib/storefront"

const manifest = getManifest()

export const metadata = {
  title: manifest.config.store.name,
  other: {
    "platform-deployment": manifest.deployment_id,
    "storefront-core-version": manifest.core_version,
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  )
}
