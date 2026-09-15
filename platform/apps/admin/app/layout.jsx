import "./tokens.css"
import "./admin.css"
import "./frame.css"
import "@platform/storefront-core/template/components/storefront.css"

export const metadata = {
  title: "Amboras",
  robots: { index: false, follow: false },
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  )
}
