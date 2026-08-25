'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

type Step = 'loading' | 'email' | 'verify-email' | 'phone' | 'verify-phone' | 'done'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

async function apiFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string }
    throw new Error(body.detail ?? body.message ?? `Erreur ${res.status}`)
  }
  return res.json()
}

export default function OnboardingPage() {
  const { token, isAuthenticated } = useAuth()
  const router = useRouter()

  const [step, setStep] = useState<Step>('loading')
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [phone, setPhone] = useState('')

  const checkStatus = useCallback(async () => {
    if (!token) return
    try {
      const status = (await apiFetch('/auth/onboarding/status', token)) as {
        emailReplaced: boolean
        phoneVerified: boolean
        complete: boolean
        currentPhone: string | null
      }
      if (status.complete) {
        router.replace('/')
        return
      }
      setPhone(status.currentPhone ?? '')
      if (!status.emailReplaced) {
        setStep('email')
      } else {
        setStep('phone')
      }
    } catch {
      setError('Impossible de charger votre statut.')
      setStep('email')
    }
  }, [token, router])

  useEffect(() => {
    if (isAuthenticated) void checkStatus()
  }, [isAuthenticated, checkStatus])

  async function handleSendEmailCode(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setSending(true)
    try {
      await apiFetch('/auth/onboarding/send-email-code', token, {
        method: 'POST',
        body: JSON.stringify({ email: newEmail }),
      })
      setStep('verify-email')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSending(false)
    }
  }

  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setSending(true)
    try {
      await apiFetch('/auth/onboarding/verify-email', token, {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      setCode('')
      setStep('phone')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSending(false)
    }
  }

  async function handleSendPhoneCode() {
    if (!token) return
    setError('')
    setSending(true)
    try {
      await apiFetch('/auth/onboarding/send-phone-code', token, { method: 'POST' })
      setStep('verify-phone')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSending(false)
    }
  }

  async function handleVerifyPhone(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setSending(true)
    try {
      await apiFetch('/auth/onboarding/verify-phone', token, {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      setStep('done')
      setTimeout(() => router.replace('/'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSending(false)
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="inline-grid size-12 place-items-center rounded-xl bg-ink text-lg font-bold text-white">
            F
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Configuration du compte</h1>
          <p className="mt-1 text-sm text-slate">
            Remplacez vos identifiants temporaires par ceux de votre &eacute;cole.
          </p>
        </div>

        {/* Progress */}
        <div className="mb-6 flex items-center gap-2">
          <div className={`h-1 flex-1 rounded-full ${step === 'email' || step === 'verify-email' ? 'bg-accent' : step === 'loading' ? 'bg-line' : 'bg-accent'}`} />
          <div className={`h-1 flex-1 rounded-full ${step === 'phone' || step === 'verify-phone' || step === 'done' ? 'bg-accent' : 'bg-line'}`} />
        </div>

        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          </div>
        )}

        {step === 'email' && (
          <form onSubmit={(e) => void handleSendEmailCode(e)} className="flex flex-col gap-4">
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-xs text-slate">
                Entrez l&apos;adresse e-mail officielle de votre &eacute;cole. Un code de v&eacute;rification y sera envoy&eacute;.
              </p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Nouvel e-mail</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="contact@votre-ecole.com"
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              {sending ? 'Envoi…' : 'Envoyer le code'}
            </button>
          </form>
        )}

        {step === 'verify-email' && (
          <form onSubmit={(e) => void handleVerifyEmail(e)} className="flex flex-col gap-4">
            <p className="text-sm text-slate">
              Un code &agrave; 6 chiffres a &eacute;t&eacute; envoy&eacute; &agrave; <strong className="text-ink">{newEmail}</strong>.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Code de v&eacute;rification</span>
              <input
                type="text"
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-center font-mono text-lg tracking-[0.3em] text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={sending || code.length < 6}
              className="h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              {sending ? 'Vérification…' : 'Vérifier'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError('') }}
              className="text-sm text-slate underline"
            >
              Changer d&apos;e-mail
            </button>
          </form>
        )}

        {step === 'phone' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-xs text-slate">
                V&eacute;rifiez votre num&eacute;ro de t&eacute;l&eacute;phone pour s&eacute;curiser votre compte.
              </p>
            </div>
            <p className="text-sm text-ink">
              Num&eacute;ro : <strong className="font-mono">{phone}</strong>
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="button"
              disabled={sending}
              onClick={() => void handleSendPhoneCode()}
              className="h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              {sending ? 'Envoi…' : 'Envoyer le code SMS'}
            </button>
          </div>
        )}

        {step === 'verify-phone' && (
          <form onSubmit={(e) => void handleVerifyPhone(e)} className="flex flex-col gap-4">
            <p className="text-sm text-slate">
              Un code &agrave; 6 chiffres a &eacute;t&eacute; envoy&eacute; au <strong className="text-ink font-mono">{phone}</strong>.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Code de v&eacute;rification</span>
              <input
                type="text"
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-center font-mono text-lg tracking-[0.3em] text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={sending || code.length < 6}
              className="h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              {sending ? 'Vérification…' : 'Vérifier'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="grid size-12 place-items-center rounded-full bg-positive/10 text-2xl text-positive">
              &#10003;
            </div>
            <p className="text-sm font-medium text-ink">Compte configur&eacute; !</p>
            <p className="text-xs text-slate">Redirection en cours…</p>
          </div>
        )}
      </div>
    </div>
  )
}
