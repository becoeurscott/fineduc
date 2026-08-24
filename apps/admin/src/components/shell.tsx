'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { useApp } from '@/lib/app-context'
import { useAuth } from '@/lib/auth'

interface NavItem {
  href: string
  label: string
  icon: string
}

const NAV: NavItem[] = [
  { href: '/', label: 'Vue d’ensemble', icon: '◧' },
  { href: '/signups', label: 'Inscriptions', icon: '▣' },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const { locale, setLocale } = useApp()
  const { logout } = useAuth()
  const pathname = usePathname()

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-sm font-bold text-white">
              F
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-ink">Fineduc Admin</p>
              <p className="truncate text-[11px] text-slate">Plateforme</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-line p-0.5">
              {(['fr', 'en'] as const).map((code) => (
                <button
                  key={code}
                  onClick={() => setLocale(code)}
                  aria-pressed={locale === code}
                  className={clsx(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    locale === code ? 'bg-ink text-white' : 'text-slate hover:text-ink',
                  )}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-slate transition-colors hover:bg-surface hover:text-ink"
            >
              {locale === 'fr' ? 'Déconnexion' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-5">
        <nav className="hidden w-52 shrink-0 lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors',
                      active ? 'bg-ink text-white' : 'text-slate hover:bg-surface hover:text-ink',
                    )}
                  >
                    <span aria-hidden="true" className="text-xs opacity-70">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-slate">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
