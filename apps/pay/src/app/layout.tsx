import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Fineduc',
  /*
   * Deliberately generic, and deliberately noindex below.
   *
   * A link to this page travels through WhatsApp, which generates a preview
   * card. A title naming the school and the child would put a family's
   * business in a group chat's preview, and a crawler that followed the link
   * would put it in a search index (AGENTS.md rule #11).
   */
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-surface text-ink antialiased">{children}</body>
    </html>
  )
}
