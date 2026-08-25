'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

type Step = 'credentials' | 'select-tenant' | 'sending'

interface Membership {
  id: string
  tenantId: string
  tenantName: string
  role: string
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth()
  const router = useRouter()

  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [selectionToken, setSelectionToken] = useState('')

  if (isAuthenticated) {
    router.replace('/')
    return null
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setStep('sending')

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string; title?: string } | null
        setError(body?.detail ?? body?.title ?? 'Identifiants incorrects')
        setStep('credentials')
        return
      }

      const data = (await res.json()) as {
        accessToken?: string
        refreshToken?: string
        selectionToken?: string
        memberships?: Membership[]
        totpRequired?: boolean
      }

      if (data.accessToken && data.refreshToken) {
        login(data.accessToken, data.refreshToken)
        router.replace('/')
        return
      }

      if (data.selectionToken && data.memberships) {
        setSelectionToken(data.selectionToken)
        setMemberships(data.memberships)
        setStep('select-tenant')
        return
      }

      if (data.totpRequired) {
        setError('2FA non supporté dans cette version.')
        setStep('credentials')
        return
      }

      setError('Réponse inattendue du serveur.')
      setStep('credentials')
    } catch {
      setError('Impossible de joindre le serveur.')
      setStep('credentials')
    }
  }

  async function handleSelectTenant(tenantId: string) {
    setError('')
    setStep('sending')

    try {
      const res = await fetch(`${API_URL}/auth/select-tenant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectionToken, tenantId }),
      })

      if (!res.ok) {
        setError('Sélection échouée.')
        setStep('select-tenant')
        return
      }

      const data = (await res.json()) as { accessToken: string; refreshToken: string }
      login(data.accessToken, data.refreshToken)
      router.replace('/')
    } catch {
      setError('Impossible de joindre le serveur.')
      setStep('select-tenant')
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="inline-grid size-12 place-items-center rounded-xl bg-ink text-lg font-bold text-white">
            F
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Fineduc</h1>
          <p className="mt-1 text-sm text-slate">Tableau de bord</p>
        </div>

        {step === 'credentials' && (
          <form onSubmit={(e) => void handleLogin(e)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Adresse e-mail</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="directeur@ecole.com"
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Mot de passe</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button
              type="submit"
              className="mt-2 h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Se connecter
            </button>
          </form>
        )}

        {step === 'select-tenant' && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-slate">Choisissez votre école</p>
            {memberships.map((m) => (
              <button
                key={m.tenantId}
                type="button"
                onClick={() => void handleSelectTenant(m.tenantId)}
                className="flex h-14 items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-left transition-colors hover:border-accent"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink text-xs font-bold text-white">
                  {m.tenantName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{m.tenantName}</p>
                  <p className="truncate text-xs text-slate">{m.role}</p>
                </div>
              </button>
            ))}
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="button"
              onClick={() => { setStep('credentials'); setError('') }}
              className="mt-2 text-sm text-slate underline"
            >
              Retour
            </button>
          </div>
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
