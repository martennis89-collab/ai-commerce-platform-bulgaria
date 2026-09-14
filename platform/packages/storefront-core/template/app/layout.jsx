import "./globals.css"
import { getManifest } from "../lib/storefront"

const manifest = getManifest()
const { theme } = manifest.config

/** Validated theme tokens (storefront-schema v2 guarantees readable contrast). */
const themeStyle = {
  "--paper": theme.colors.paper,
  "--ink": theme.colors.ink,
  "--muted": theme.colors.muted,
  "--accent": theme.colors.accent,
  "--accent-ink": theme.colors.accent_ink,
  "--line": theme.colors.line,
  "--radius": theme.corner === "square" ? "2px" : "8px",
}

export const metadata = {
  title: manifest.config.store.name,
  other: {
    "platform-deployment": manifest.deployment_id,
    "storefront-core-version": manifest.core_version,
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="bg" data-typography={theme.typography} style={themeStyle}>
      <body>{children}</body>
    </html>
  )
}
