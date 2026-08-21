'use client'

import { usePathname } from 'next/navigation'
import { Shell } from './shell'

/**
 * Renders the Shell (sidebar, header) on every page except /login.
 * The login page has its own full-screen layout with no navigation.
 */
export function ShellGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/login') return <>{children}</>
  return <Shell>{children}</Shell>
}
