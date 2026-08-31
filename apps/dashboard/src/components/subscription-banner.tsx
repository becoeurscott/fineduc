'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { SubscriptionState } from '@fineduc/contracts'
import { useAuth } from '@/lib/auth'
import { useApp } from '@/lib/app-context'
import { pad, remainingUntil } from '@/lib/countdown'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

/**
 * The subscription countdown, on every page.
 *
 * Nothing renews itself: a school pays by mobile money, by hand, each period.
 * So the deadline has to be visible in the product rather than only in a
 * message — a bursar who never receives the reminder (wrong number, no credit,
 * a message pipeline that is down) would otherwise find out by being locked
 * out mid-morning with parents at the desk.
 *
 * The countdown ticks against `accessEndsAt`, an instant the SERVER resolved
 * from the school's own timezone. It is never recomputed here: a laptop set to
 * the wrong zone would count down to the wrong moment, and the banner would
 * then disagree with the guard that actually does the blocking.
 */

/** Only shown inside this window — a countdown running all month is wallpaper. */
const SHOW_WITHIN_DAYS = 7

export function SubscriptionBanner() {
  const { token } = useAuth()
  const { locale } = useApp()
  const [state, setState] = useState<SubscriptionState | null>(null)
  /*
   * `null` until the first client tick. Rendering a countdown during SSR would
   * hydrate with a timestamp already a second or two stale, which React
   * reports as a mismatch — and the number would visibly jump on load.
   */
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetch(`${API_URL}/tenant/subscription`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setState(data as SubscriptionState)
      })
      // A banner that cannot load its own state says nothing rather than
      // showing an error: it is an aside, not the page's job.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  if (!state || now === null) return null

  const target = new Date(state.accessEndsAt).getTime()
  const left = remainingUntil(target, now)
  const lapsed = state.lapsed || left.total === 0

  // Quiet until the last week. Before that the school has nothing to act on.
  if (!lapsed && left.days >= SHOW_WITHIN_DAYS) return null

  const copy = TEXT[locale === 'en' ? 'en' : 'fr']
  const urgent = lapsed || left.days < 1

  return (
    <div
      role={lapsed ? 'alert' : 'status'}
      className={clsx(
        'flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-sm',
        // The -soft tokens are the theme's own background pairings; an opacity
        // modifier on the solid tone would drift from every other surface.
        lapsed
          ? 'border-danger bg-danger-soft text-danger'
          : urgent
            ? 'border-warning bg-warning-soft text-ink'
            : 'border-line bg-surface text-ink',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true">{lapsed ? '⛔' : '⏳'}</span>
        <span className="font-medium">{lapsed ? copy.lapsedTitle : copy.endingTitle}</span>
        {lapsed ? (
          <span className="text-slate">{copy.lapsedBody}</span>
        ) : (
          <>
            <span
              /*
               * The clock is the point, so it is announced as one unit rather
               * than letting a screen reader read four separate numbers — and
               * politely, so it does not interrupt every second.
               */
              aria-live="off"
              aria-label={`${left.days} ${copy.days}, ${left.hours} h ${left.minutes} min ${left.seconds} s`}
              className="font-mono tabular-nums font-semibold"
            >
              {left.days > 0 ? `${left.days} ${copy.days} · ` : null}
              {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
            </span>
            <span className="text-slate">{copy.endingBody}</span>
          </>
        )}
      </div>

      <a
        href="/abonnement"
        className={clsx(
          'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
          lapsed ? 'bg-danger text-white hover:opacity-90' : 'bg-ink text-white hover:opacity-90',
        )}
      >
        {copy.cta}
      </a>
    </div>
  )
}

const TEXT = {
  fr: {
    endingTitle: 'Votre abonnement se termine dans',
    endingBody: "— renouvelez pour éviter l'interruption.",
    lapsedTitle: 'Abonnement échu.',
    lapsedBody: "L'accès est suspendu jusqu'au renouvellement.",
    days: 'j',
    cta: 'Renouveler',
  },
  en: {
    endingTitle: 'Your subscription ends in',
    endingBody: '— renew to avoid interruption.',
    lapsedTitle: 'Subscription expired.',
    lapsedBody: 'Access is suspended until you renew.',
    days: 'd',
    cta: 'Renew',
  },
} as const
