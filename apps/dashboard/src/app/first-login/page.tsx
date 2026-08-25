'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

type Step = 'email' | 'code' | 'sending'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

export default function FirstLoginPage() {
  const { login, isAuthenticated } = useAuth()
  const router = useRouter()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  if (isAuthenticated) {
    router.replace('/')
    return null
  }

  function handleEmailNext(e: React.FormEvent) {
    e.preventDefault()
    setError('')
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
        body: JSON.stringify({ email, code }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null
        setError(body?.detail ?? body?.message ?? 'E-mail ou code incorrect')
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
          <p className="mt-1 text-sm text-slate">Acc&eacute;dez au tableau de bord de votre &eacute;cole</p>
        </div>

        {step === 'email' && (
          <form onSubmit={handleEmailNext} className="flex flex-col gap-4">
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-xs leading-relaxed text-slate">
                Entrez l&apos;e-mail temporaire re&ccedil;u par WhatsApp apr&egrave;s la validation de votre inscription.
              </p>
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
                placeholder="fin-2026-0001@fineduc.school"
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 font-mono text-sm text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="submit"
              className="mt-2 h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Suivant
            </button>
            <a
              href="/login"
              className="mt-1 text-center text-xs text-slate underline hover:text-ink"
            >
              D&eacute;j&agrave; un compte ? Se connecter
            </a>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={(e) => void handleLogin(e)} className="flex flex-col gap-4">
            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="text-xs text-slate">
                E-mail : <strong className="font-mono text-ink">{email}</strong>
              </p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Code d&apos;acc&egrave;s</span>
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
                Le code re&ccedil;u par WhatsApp lors de la validation de votre inscription.
              </span>
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="submit"
              className="mt-2 h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError('') }}
              className="text-sm text-slate underline"
            >
              Modifier l&apos;e-mail
            </button>
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
