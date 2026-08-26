'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

type Step = 'loading' | 'email' | 'code' | 'expired' | 'sending'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

interface SetupInfo {
  schoolName: string
  contactName: string
  tempIdentifier: string
}

export default function FirstLoginPage() {
  const { login, isAuthenticated } = useAuth()
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = params.token

  const [step, setStep] = useState<Step>('loading')
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/setup/${token}`)
      if (!res.ok) {
        setStep('expired')
        return
      }
      const data = (await res.json()) as SetupInfo
      setInfo(data)
      setStep('email')
    } catch {
      setStep('expired')
    }
  }, [token])

  useEffect(() => {
    void loadInfo()
  }, [loadInfo])

  if (isAuthenticated) {
    router.replace('/')
    return null
  }

  function handleEmailNext(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim()) {
      setError('Veuillez entrer votre e-mail temporaire.')
      return
    }
    setStep('code')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setStep('sending')

    try {
      const res = await fetch(`${API_URL}/auth/login-school`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, code, email }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null
        setError(body?.detail ?? body?.message ?? 'Code incorrect')
        setStep('code')
        return
      }

      const data = (await res.json()) as { accessToken: string; refreshToken: string; needsOnboarding?: boolean }
      login(data.accessToken, data.refreshToken)
      router.replace(data.needsOnboarding ? '/onboarding' : '/')
    } catch {
      setError('Impossible de joindre le serveur.')
      setStep('code')
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="inline-grid size-12 place-items-center rounded-xl bg-ink text-lg font-bold text-white">
            F
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Première connexion</h1>
        </div>

        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          </div>
        )}

        {step === 'expired' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-danger">Ce lien est invalide ou a expiré.</p>
            <p className="text-xs text-slate">
              Connectez-vous avec l&apos;e-mail et le code reçus par WhatsApp.
            </p>
            <a href="/login" className="text-sm font-medium text-ink underline">
              Se connecter
            </a>
          </div>
        )}

        {step === 'email' && info && (
          <form onSubmit={handleEmailNext} className="flex flex-col gap-4">
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-sm font-medium text-ink">{info.schoolName}</p>
              <p className="mt-0.5 text-xs text-slate">{info.contactName} &middot; {info.tempIdentifier}</p>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">E-mail temporaire</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="fin-2026-001@fineduc.school"
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-xs text-slate">
                L&apos;e-mail temporaire reçu par WhatsApp lors de la validation.
              </span>
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button
              type="submit"
              className="mt-2 h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Suivant
            </button>
          </form>
        )}

        {step === 'code' && info && (
          <form onSubmit={(e) => void handleLogin(e)} className="flex flex-col gap-4">
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-sm font-medium text-ink">{info.schoolName}</p>
              <p className="mt-0.5 text-xs text-slate">{email}</p>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Code d&apos;accès</span>
              <input
                type="text"
                required
                autoFocus
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 font-mono text-sm tracking-wider text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-xs text-slate">
                Le code reçu par WhatsApp lors de la validation de votre inscription.
              </span>
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => { setStep('email'); setError(''); setCode('') }}
                className="h-11 flex-1 rounded-[var(--radius-control)] border border-line text-sm font-medium text-slate transition-colors hover:border-ink hover:text-ink"
              >
                Retour
              </button>
              <button
                type="submit"
                className="h-11 flex-1 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90"
              >
                Se connecter
              </button>
            </div>
          </form>
        )}

        {step === 'sending' && (
          <div className="flex justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  )
}
