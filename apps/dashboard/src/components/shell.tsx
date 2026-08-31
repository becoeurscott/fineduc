'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { can, type Capability } from '@fineduc/contracts'
import { useApp } from '@/lib/app-context'
import { useAuth } from '@/lib/auth'
import { ROLE_LABEL, type TranslationKey } from '@/lib/i18n'
import { SubscriptionBanner } from './subscription-banner'

interface NavItem {
  href: string
  labelKey: TranslationKey
  capability: Capability
  icon: string
}

/**
 * Nav is filtered by the shared capability matrix, so a cashier simply
 * never sees the arrears queue or the audit log. This is a courtesy, not a
 * security boundary — the API refuses the same calls server-side
 * (packages/contracts/src/permissions.ts).
 */
const NAV: NavItem[] = [
  { href: '/', labelKey: 'nav.overview', capability: 'dashboard.view', icon: '◧' },
  { href: '/students', labelKey: 'nav.students', capability: 'students.view', icon: '◉' },
  { href: '/arrears', labelKey: 'nav.arrears', capability: 'dashboard.view', icon: '◭' },
  { href: '/cash', labelKey: 'nav.cash', capability: 'payments.record_cash', icon: '▤' },
  { href: '/payments', labelKey: 'nav.payments', capability: 'dashboard.view', icon: '⇄' },
  { href: '/fees', labelKey: 'nav.fees', capability: 'fees.publish', icon: '▦' },
  { href: '/reminders', labelKey: 'nav.reminders', capability: 'reminders.send', icon: '◌' },
  { href: '/moratoires', labelKey: 'nav.moratoires', capability: 'moratorium.view', icon: '◷' },
  { href: '/admin', labelKey: 'nav.admin', capability: 'users.manage', icon: '⚙' },
  // Director-gated on users.manage: there is no billing capability, and paying
  // for the school is the same audience that manages its people.
  { href: '/abonnement', labelKey: 'nav.subscription', capability: 'users.manage', icon: '◈' },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const { t, user, locale, setLocale } = useApp()
  const { logout } = useAuth()
  const pathname = usePathname()
  const role = user?.role ?? 'director'
  const items = NAV.filter((item) => can(role, item.capability))

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-sm font-bold text-white">
              F
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-ink">{user?.tenantName ?? 'Fineduc'}</p>
              <p className="truncate text-[11px] text-slate">
                {user ? `${ROLE_LABEL[locale][user.role]} · ${user.name}` : '…'}
              </p>
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
              title={locale === 'fr' ? 'Déconnexion' : 'Sign out'}
            >
              {locale === 'fr' ? 'Déconnexion' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      {/* Directly under the header, above the nav: a deadline nobody can
          renew is worse than one they scrolled past. Renders nothing until
          the last week. */}
      <SubscriptionBanner />

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-5">
        {/* Sidebar on desktop only — the phone gets the bottom bar below. */}
        <nav className="hidden w-52 shrink-0 lg:block" aria-label={t('nav.overview')}>
          <ul className="sticky top-20 space-y-0.5">
            {items.map((item) => {
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
                    <span aria-hidden="true" className="text-xs opacity-70">
                      {item.icon}
                    </span>
                    {t(item.labelKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* pb-24 clears the fixed mobile bar so the last row is never buried. */}
        <main className="min-w-0 flex-1 pb-24 lg:pb-0">{children}</main>
      </div>

      {/*
        Mobile bottom bar. The director decides from a phone standing up
        (PRD §3) — the primary destinations must be one thumb-tap away, not
        behind a hamburger.
      */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
        aria-label={t('nav.overview')}
      >
        <ul className="flex items-stretch justify-around">
          {items.slice(0, 5).map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors',
                    active ? 'text-ink' : 'text-slate',
                  )}
                >
                  <span aria-hidden="true" className={clsx('text-base', active && 'scale-110')}>
                    {item.icon}
                  </span>
                  <span className="truncate">{t(item.labelKey)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
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
