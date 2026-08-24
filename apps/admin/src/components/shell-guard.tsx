'use client'

import { usePathname } from 'next/navigation'
import { Shell } from './shell'

export function ShellGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/login' || pathname.startsWith('/setup')) return <>{children}</>
  return <Shell>{children}</Shell>
}
