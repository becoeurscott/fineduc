'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import clsx from 'clsx'
import { Amount, Button, Card, CardBody, ErrorState, Skeleton } from '@fineduc/ui'
import type { SubscriptionPlanContract, SubscriptionState } from '@fineduc/contracts'
import { useAuth } from '@/lib/auth'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'
import { pad, remainingUntil } from '@/lib/countdown'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

/**
 * `/abonnement` — the one page a locked-out school can still reach.
 *
 * It carries three states, because they are the same question at different
 * moments: how long is left, how do I pay, and did the payment land.
 *
 * The RETURN state is the subtle one. Chariow's redirect proves only that a
 * browser came back — the payment is confirmed by the Pulse arriving at the
 * API and the reconciler re-pulling the sale. So the page polls the real
 * subscription rather than believing the redirect: showing "you're all set"
 * on arrival would read as broken the moment the school clicked through and
 * found itself still locked out.
 */

/** How long to keep asking the API whether the webhook has landed. */
const CONFIRM_POLL_MS = 3_000
const CONFIRM_TIMEOUT_MS = 120_000

export default function SubscriptionPage() {
  const { token } = useAuth()
  const { locale, user } = useApp()
  /*
   * Only a director can pay — the checkout endpoint is @Roles('director').
   * Everyone else still reaches this page, because the banner points every
   * role here and a cashier locked out mid-shift needs to know WHY. They see
   * the status and are told who can fix it, rather than a button that 403s.
   */
  const canPay = (user?.role ?? 'director') === 'director'
  const params = useSearchParams()
  const copy = TEXT[locale === 'en' ? 'en' : 'fr']

  const [state, setState] = useState<SubscriptionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busyPlan, setBusyPlan] = useState<SubscriptionPlanContract | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)

  /** Chariow sends the browser back here after payment. */
  const returning = params.get('status') === 'success'
  const [confirming, setConfirming] = useState(returning)
  const [confirmTimedOut, setConfirmTimedOut] = useState(false)

  const load = useCallback(async (): Promise<SubscriptionState | null> => {
    if (!token) return null
    const res = await fetch(`${API_URL}/tenant/subscription`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return (await res.json()) as SubscriptionState
  }, [token])

  useEffect(() => {
    let cancelled = false
    void load()
      .then((data) => {
        if (cancelled) return
        if (data) setState(data)
        else setFailed(true)
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  /*
   * Poll after a return from Chariow until the subscription actually moves.
   * Gives up after two minutes rather than spinning forever — a webhook that
   * has not arrived by then needs a human, and the honest message is "we are
   * still waiting", not an indefinite spinner.
   */
  useEffect(() => {
    if (!confirming) return
    const startedAt = Date.now()
    const id = setInterval(() => {
      if (Date.now() - startedAt > CONFIRM_TIMEOUT_MS) {
        setConfirming(false)
        setConfirmTimedOut(true)
        return
      }
      void load().then((data) => {
        if (!data) return
        setState(data)
        // The webhook settled it: the deadline moved into the future.
        if (!data.lapsed && Date.now() < new Date(data.accessEndsAt).getTime()) {
          setConfirming(false)
        }
      })
    }, CONFIRM_POLL_MS)
    return () => clearInterval(id)
  }, [confirming, load])

  async function subscribe(plan: SubscriptionPlanContract) {
    if (!token) return
    setBusyPlan(plan)
    setCheckoutError(null)
    try {
      const res = await fetch(`${API_URL}/tenant/subscription/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          plan,
          billingPeriod: 'monthly',
          payerPhoneE164: '+237670000000',
          returnUrl: `${window.location.origin}/abonnement?status=success`,
        }),
      })
      const body = (await res.json()) as { checkoutUrl?: string | null; detail?: string }
      if (!res.ok || !body.checkoutUrl) {
        setCheckoutError(body.detail ?? copy.checkoutFailed)
        return
      }
      window.location.href = body.checkoutUrl
    } catch {
      setCheckoutError(copy.checkoutFailed)
    } finally {
      setBusyPlan(null)
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={copy.title} />
        <Card>
          <CardBody>
            <Skeleton className="h-24 w-full" />
          </CardBody>
        </Card>
      </>
    )
  }

  if (failed || !state) {
    return (
      <>
        <PageHeader title={copy.title} />
        <Card>
          <ErrorState title={copy.loadFailed} onRetry={() => window.location.reload()} />
        </Card>
      </>
    )
  }

  const target = new Date(state.accessEndsAt).getTime()
  const left = remainingUntil(target, now ?? target)
  const lapsed = state.lapsed || left.total === 0

  return (
    <>
      <PageHeader title={copy.title} description={copy.subtitle} />

      {confirming ? (
        <Card className="mb-4">
          <CardBody>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-ink"
              />
              <div>
                <p className="font-medium text-ink">{copy.confirmingTitle}</p>
                <p className="mt-0.5 text-sm text-slate">{copy.confirmingBody}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {confirmTimedOut ? (
        <Card className="mb-4">
          <CardBody>
            <p className="font-medium text-ink">{copy.confirmSlowTitle}</p>
            <p className="mt-0.5 text-sm text-slate">{copy.confirmSlowBody}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* Current standing. Red once the lock has closed. */}
      <Card className={clsx('mb-4', lapsed && 'border-danger')}>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-slate">{lapsed ? copy.statusLapsed : copy.statusActive}</p>
              <p className="mt-1 text-lg font-semibold capitalize text-ink">
                {state.plan} · {copy.monthly}
              </p>
              <p className="mt-0.5 text-sm text-slate">
                {lapsed
                  ? `${copy.endedOn} ${state.currentPeriodEnd}`
                  : `${copy.renewBy} ${state.currentPeriodEnd}`}
              </p>
            </div>

            {!lapsed && now !== null ? (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate">{copy.remaining}</p>
                <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
                  {left.days > 0 ? `${left.days}${copy.days} ` : null}
                  {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
                </p>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {checkoutError ? (
        <Card className="mb-4 border-danger">
          <CardBody>
            <p className="text-sm text-danger">{checkoutError}</p>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {state.plans.map((offer) => {
          const current = offer.plan === state.plan
          return (
            <Card key={offer.plan} className={clsx(current && 'border-ink')}>
              <CardBody>
                <p className="text-sm font-semibold capitalize text-ink">{offer.plan}</p>
                <p className="mt-0.5 text-xs text-slate">
                  {offer.studentCap === null
                    ? copy.uncapped
                    : `${copy.upTo} ${offer.studentCap} ${copy.students}`}
                </p>
                <div className="mt-3">
                  {/* Amount takes the wire shape as-is — the string never
                      becomes a JS number, which is the point for money. */}
                  <Amount value={{ amountMinor: offer.monthlyMinor, currency: 'XAF' }} size="lg" />
                  <span className="ml-1 text-sm text-slate">{copy.perMonth}</span>
                </div>
                {canPay ? (
                  <Button
                    className="mt-4 w-full"
                    variant={current ? 'primary' : 'secondary'}
                    loading={busyPlan === offer.plan}
                    disabled={busyPlan !== null}
                    onClick={() => void subscribe(offer.plan)}
                  >
                    {lapsed ? copy.reactivate : current ? copy.renew : copy.switchTo}
                  </Button>
                ) : null}
              </CardBody>
            </Card>
          )
        })}
      </div>

      <p className="mt-4 text-xs text-slate">{canPay ? copy.manualNote : copy.directorOnly}</p>
    </>
  )
}

const TEXT = {
  fr: {
    title: 'Abonnement',
    subtitle: 'Votre formule Fineduc et son renouvellement.',
    statusActive: 'Abonnement actif',
    statusLapsed: 'Abonnement échu — accès suspendu',
    monthly: 'mensuel',
    renewBy: 'À renouveler avant le',
    endedOn: 'Terminé le',
    remaining: 'Temps restant',
    days: 'j',
    perMonth: '/ mois',
    upTo: "Jusqu'à",
    students: 'élèves',
    uncapped: 'Sans limite · multi-campus',
    renew: 'Renouveler',
    reactivate: 'Réactiver',
    switchTo: 'Choisir cette formule',
    confirmingTitle: 'Confirmation du paiement…',
    confirmingBody:
      "Nous attendons la confirmation de l'opérateur. Cette page se met à jour toute seule.",
    confirmSlowTitle: 'Paiement pas encore confirmé',
    confirmSlowBody:
      "Si le montant a été débité, l'accès se rétablira dès réception. Contactez-nous si rien ne change.",
    checkoutFailed: "Le paiement n'a pas pu être ouvert. Réessayez.",
    loadFailed: "Impossible de charger l'abonnement",
    manualNote:
      "Le renouvellement est manuel : rien n'est prélevé automatiquement. Vous êtes prévenu 7, 3 et 1 jour avant l'échéance.",
    directorOnly:
      "Seul le directeur peut renouveler l'abonnement. Signalez-lui l'échéance pour rétablir l'accès.",
  },
  en: {
    title: 'Subscription',
    subtitle: 'Your Fineduc plan and its renewal.',
    statusActive: 'Subscription active',
    statusLapsed: 'Subscription expired — access suspended',
    monthly: 'monthly',
    renewBy: 'Renew before',
    endedOn: 'Ended on',
    remaining: 'Time remaining',
    days: 'd',
    perMonth: '/ month',
    upTo: 'Up to',
    students: 'students',
    uncapped: 'Uncapped · multi-campus',
    renew: 'Renew',
    reactivate: 'Reactivate',
    switchTo: 'Choose this plan',
    confirmingTitle: 'Confirming payment…',
    confirmingBody: "We're waiting on the operator. This page updates itself.",
    confirmSlowTitle: 'Payment not confirmed yet',
    confirmSlowBody:
      'If you were charged, access restores as soon as it arrives. Contact us if nothing changes.',
    checkoutFailed: 'Checkout could not be opened. Please try again.',
    loadFailed: 'Could not load your subscription',
    manualNote:
      'Renewal is manual — nothing is charged automatically. You are warned 7, 3 and 1 day before it ends.',
    directorOnly:
      'Only the director can renew the subscription. Let them know so access can be restored.',
  },
} as const
