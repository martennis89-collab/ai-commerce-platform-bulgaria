import "./globals.css"
import "../components/storefront.css"
import { getManifest } from "../lib/storefront"

const manifest = getManifest()
const { theme } = manifest.config

export const metadata = {
  title: manifest.config.store.name,
  other: {
    "platform-deployment": manifest.deployment_id,
    "platform-revision": manifest.revision_id ?? "",
    "storefront-core-version": manifest.core_version,
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="bg">
      <body style={{ background: theme.colors.paper }}>{children}</body>
    </html>
  )
}
