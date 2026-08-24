import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AppProviders } from '@/lib/app-context'
import { AuthProvider } from '@/lib/auth'
import { ShellGuard } from '@/components/shell-guard'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Fineduc Admin',
  description: 'Administration de la plateforme Fineduc.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
