import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AppProviders } from '@/lib/app-context'
import { AuthProvider } from '@/lib/auth'
import { ShellGuard } from '@/components/shell-guard'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Fineduc — Tableau de bord',
  description: 'Recouvrement des frais de scolarité. Le directeur voit tout en temps réel.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never block zoom — a director reading arrears in daylight will pinch,
  // and WCAG 2.1 AA requires it (ARCHITECTURE.md §13).
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body>
        <AuthProvider>
          <AppProviders>
            <ShellGuard>{children}</ShellGuard>
          </AppProviders>
        </AuthProvider>
      </body>
    </html>
  )
}
