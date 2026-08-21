'use client'

import { useState } from 'react'
import type { MoratoriumChatView, MoratoriumRequestResult } from '@fineduc/contracts'
import { longDate, t, type Locale } from '@/lib/i18n'

/**
 * A SCRIPTED chat, not a conversational one.
 *
 * The parent answers by tapping, never by typing. A free-text box on a 2G
 * phone, for someone who may not read fluently and may be anxious about
 * money, produces support calls and misunderstandings — and a model
 * interpreting free text on a PUBLIC unauthenticated endpoint would be a
 * prompt-injection surface on a decision that moves a real date.
 *
 * The one text field is an OPTIONAL reason, which nothing parses.
 *
 * States: greeting → choosing → confirming → done | unavailable | error.
 * No date arithmetic happens here: the server sends dates already computed,
 * because a browser clock in the wrong timezone would show a parent a
 * different deadline from the one the school recorded.
 */
type Step = 'choosing' | 'confirming' | 'sending' | 'done' | 'error'

export function MoratoireChat({ token, view }: { token: string; view: MoratoriumChatView }) {
  const locale = view.locale as Locale
  const copy = t(locale)

  const [step, setStep] = useState<Step>('choosing')
  const [days, setDays] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<MoratoriumRequestResult | null>(null)
  const [freeText, setFreeText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState(false)

  const amount = `${Number(view.amountDue.amountMinor).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB')} FCFA`
  const chosen = view.offer.options.find((option) => option.days === days) ?? null

  async function parseText() {
    if (freeText.trim() === '') return
    setParsing(true)
    setParseError(false)
    try {
      const response = await fetch(`/api/moratoire/${encodeURIComponent(token)}/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: freeText.trim() }),
      })
      if (!response.ok) { setParseError(true); return }
      const parsed = (await response.json()) as { days: number | null; deferredDueOn: string | null }
      if (parsed.days !== null) {
        setDays(parsed.days)
        setStep('confirming')
      } else {
        setParseError(true)
      }
    } catch {
      setParseError(true)
    } finally {
      setParsing(false)
    }
  }

  async function submit() {
    if (days === null) return
    setStep('sending')
    try {
      const response = await fetch(`/api/moratoire/${encodeURIComponent(token)}/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          durationDays: days,
          reason: reason.trim() === '' ? undefined : reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      if (!response.ok) throw new Error('request failed')
      setResult((await response.json()) as MoratoriumRequestResult)
      setStep('done')
    } catch {
      setStep('error')
    }
  }

  return (
    <>
      <Bubble>{copy.greeting(view.schoolName)}</Bubble>
      <Bubble>
        {copy.owed(view.instalmentLabel, view.studentFirstName, amount, longDate(view.dueOn, locale))}
      </Bubble>

      {!view.offer.available && (
        <Bubble tone="muted">
          {copy.unavailable[(view.offer.reason ?? 'disabled') as keyof typeof copy.unavailable]}
        </Bubble>
      )}

      {view.offer.available && step === 'choosing' && (
        <>
          <Bubble>{copy.askDelay}</Bubble>
          <div className="flex flex-col gap-2">
            {view.offer.options.map((option) => (
              <Choice
                key={option.days}
                onClick={() => {
                  setDays(option.days)
                  setStep('confirming')
                }}
              >
                {option.days === 21 ? copy.weeksThree : copy.weeks(option.days)}
                {/* The end date on the button itself: a parent should never
                    have to tap to find out what they are agreeing to. */}
                <span className="block text-sm font-normal text-muted">
                  {copy.untilShort(longDate(option.deferredDueOn, locale))}
                </span>
              </Choice>
            ))}
          </div>

          {/* Free-text fallback for parents who type instead of tapping. */}
          <div className="mt-3 flex flex-col gap-2">
            <label className="text-sm text-muted">
              {locale === 'fr' ? 'Ou décrivez votre besoin :' : 'Or describe what you need:'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={280}
                value={freeText}
                onChange={(e) => { setFreeText(e.target.value); setParseError(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') void parseText() }}
                placeholder={locale === 'fr' ? 'Ex. : après la paie' : 'e.g. after payday'}
                disabled={parsing}
                className="min-h-[44px] flex-1 rounded-xl border border-line bg-white px-3 text-base text-ink placeholder:text-muted/50"
              />
              <button
                type="button"
                onClick={() => void parseText()}
                disabled={parsing || freeText.trim() === ''}
                className="min-h-[44px] rounded-xl bg-accent/10 px-4 text-sm font-medium text-accent disabled:opacity-40"
              >
                {parsing ? '…' : '→'}
              </button>
            </div>
            {parseError && (
              <p className="text-sm text-warning">
                {locale === 'fr'
                  ? 'Nous n\'avons pas compris. Choisissez un délai ci-dessus.'
                  : 'We didn\'t understand. Please choose a delay above.'}
              </p>
            )}
          </div>
        </>
      )}

      {view.offer.available && (step === 'confirming' || step === 'sending') && chosen && (
        <>
          <Answer>{chosen.days === 21 ? copy.weeksThree : copy.weeks(chosen.days)}</Answer>
          {/* The exact end date, stated before anything is confirmed. */}
          <Bubble>{copy.confirmTitle(longDate(chosen.deferredDueOn, locale))}</Bubble>
          <Bubble tone="muted">{copy.confirmOnce}</Bubble>
          {view.offer.collidesWithNextInstalment && (
            <Bubble tone="warning">
              {copy.collision(longDate(view.offer.latestDeferredDueOn ?? view.dueOn, locale))}
            </Bubble>
          )}

          <label className="mt-2 flex flex-col gap-1 text-sm text-muted">
            {copy.reasonLabel}
            <textarea
              maxLength={280}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={copy.reasonPlaceholder}
              className="rounded-xl border border-line bg-white p-3 text-base text-ink"
            />
          </label>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={step === 'sending'}
            className="min-h-[52px] rounded-xl bg-accent px-4 text-base font-semibold text-white disabled:opacity-60"
          >
            {copy.confirm}
          </button>
          <button
            type="button"
            onClick={() => setStep('choosing')}
            disabled={step === 'sending'}
            className="min-h-[44px] text-sm text-muted underline"
          >
            {copy.back}
          </button>
        </>
      )}

      {step === 'done' && result && (
        <Bubble tone={result.status === 'granted' ? 'success' : 'muted'}>
          {result.status === 'granted' && result.deferredDueOn ? (
            <>
              <strong className="block">{copy.grantedTitle(longDate(result.deferredDueOn, locale))}</strong>
              {copy.grantedBody}
            </>
          ) : result.status === 'pending' ? (
            <>
              {/* NEVER the word "accordé" on a pending row. */}
              <strong className="block">{copy.pendingTitle}</strong>
              {copy.pendingBody}
            </>
          ) : (
            <>
              <strong className="block">{copy.rejected}</strong>
              {result.mayAskAgain ? copy.mayAskAgain : copy.mayNotAskAgain}
            </>
          )}
        </Bubble>
      )}

      {step === 'error' && <Bubble tone="warning">{copy.error}</Bubble>}
    </>
  )
}

function Bubble({ children, tone = 'school' }: { children: React.ReactNode; tone?: 'school' | 'muted' | 'warning' | 'success' }) {
  const tones = {
    school: 'bg-white text-ink',
    muted: 'bg-white/70 text-muted',
    warning: 'bg-warning-soft text-ink',
    success: 'bg-success-soft text-ink',
  }
  return <div className={`max-w-[92%] self-start rounded-2xl rounded-bl-sm px-4 py-3 ${tones[tone]}`}>{children}</div>
}

function Answer({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[92%] self-end rounded-2xl rounded-br-sm bg-accent px-4 py-3 font-medium text-white">
      {children}
    </div>
  )
}

/** 52px minimum: a tap target for a thumb, outdoors, on a cracked screen. */
function Choice({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[52px] w-full rounded-xl border border-line bg-white px-4 text-left text-base font-medium text-ink"
    >
      {children}
    </button>
  )
}
