'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

type Step = 'loading' | 'credentials' | 'verify-email' | 'verify-phone' | 'success' | 'error'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

export default function SetupPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [step, setStep] = useState<Step>('loading')
  const [schoolName, setSchoolName] = useState('')
  const [contactName, setContactName] = useState('')
  const [tempId, setTempId] = useState('')

  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    async function loadSetupInfo() {
      try {
        const res = await fetch(`${API_URL}/auth/setup/${token}`)
        if (!res.ok) {
          setStep('error')
          setError('Ce lien est invalide ou a expiré.')
          return
        }
        const data = (await res.json()) as {
          schoolName: string
          contactName: string
          tempIdentifier: string
          email: string
          phone: string
        }
        setSchoolName(data.schoolName)
        setContactName(data.contactName)
        setTempId(data.tempIdentifier)
        setEmail(data.email)
        setPhone(data.phone)
        setStep('credentials')
      } catch {
        setStep('error')
        setError('Impossible de joindre le serveur.')
      }
    }
    void loadSetupInfo()
  }, [token])

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    setError('')
    setSending(true)

    try {
      const res = await fetch(`${API_URL}/auth/setup/account`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email, phone, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null
        setError(body?.detail ?? body?.message ?? 'Erreur lors de la configuration.')
        setSending(false)
        return
      }
      setStep('verify-email')
    } catch {
      setError('Impossible de joindre le serveur.')
    }
    setSending(false)
  }

  async function handleVerify(channel: 'email' | 'phone') {
    setError('')
    setSending(true)

    try {
      const res = await fetch(`${API_URL}/auth/setup/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, channel, code }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null
        setError(body?.detail ?? body?.message ?? 'Code invalide.')
        setSending(false)
        return
      }

      const data = (await res.json()) as {
        nextStep?: 'verify-phone' | 'complete'
        accessToken?: string
        refreshToken?: string
      }

      if (data.nextStep === 'verify-phone') {
        setCode('')
        setStep('verify-phone')
      } else if (data.accessToken && data.refreshToken) {
        localStorage.setItem('fineduc_access_token', data.accessToken)
        localStorage.setItem('fineduc_refresh_token', data.refreshToken)
        setStep('success')
        setTimeout(() => router.replace('/'), 2000)
      }
    } catch {
      setError('Impossible de joindre le serveur.')
    }
    setSending(false)
  }

  async function resendCode(channel: 'email' | 'phone') {
    try {
      await fetch(`${API_URL}/auth/setup/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, channel }),
      })
    } catch { /* silent */ }
  }

  const inputClass =
    'h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
  const btnClass =
    'mt-2 h-11 w-full rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="inline-grid size-12 place-items-center rounded-xl bg-ink text-lg font-bold text-white">
            F
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Fineduc</h1>
          {schoolName && <p className="mt-1 text-sm text-slate">{schoolName}</p>}
          {tempId && (
            <p className="mt-1 font-mono text-xs text-slate">
              Identifiant : <span className="font-semibold text-ink">{tempId}</span>
            </p>
          )}
        </div>

        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          </div>
        )}

        {step === 'error' && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-6 text-center">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        {step === 'credentials' && (
          <>
            <p className="mb-4 text-center text-sm text-slate">
              Bienvenue {contactName}. Configurez vos identifiants pour accéder au tableau de bord.
            </p>
            <form onSubmit={(e) => void handleCredentials(e)} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Adresse e-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Numéro de téléphone</span>
                <input
                  type="tel"
                  required
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Mot de passe</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Confirmer le mot de passe</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                />
              </label>

              {error && <p className="text-sm text-danger">{error}</p>}

              <button type="submit" disabled={sending} className={btnClass}>
                {sending ? 'Envoi...' : 'Continuer'}
              </button>
            </form>
          </>
        )}

        {step === 'verify-email' && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm text-slate">
              Un code de vérification a été envoyé à <span className="font-medium text-ink">{email}</span>.
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${inputClass} text-center font-mono text-lg tracking-[0.3em]`}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="button"
              disabled={code.length !== 6 || sending}
              onClick={() => void handleVerify('email')}
              className={btnClass}
            >
              {sending ? 'Vérification...' : 'Vérifier'}
            </button>
            <button
              type="button"
              onClick={() => void resendCode('email')}
              className="text-sm text-slate underline"
            >
              Renvoyer le code
            </button>
          </div>
        )}

        {step === 'verify-phone' && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm text-slate">
              Un code de vérification a été envoyé au <span className="font-medium text-ink">{phone}</span>.
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${inputClass} text-center font-mono text-lg tracking-[0.3em]`}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="button"
              disabled={code.length !== 6 || sending}
              onClick={() => void handleVerify('phone')}
              className={btnClass}
            >
              {sending ? 'Vérification...' : 'Vérifier'}
            </button>
            <button
              type="button"
              onClick={() => void resendCode('phone')}
              className="text-sm text-slate underline"
            >
              Renvoyer le code
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="rounded-lg border border-positive/30 bg-positive/5 p-6 text-center">
            <p className="text-lg font-semibold text-ink">Compte configuré !</p>
            <p className="mt-2 text-sm text-slate">Redirection vers votre tableau de bord...</p>
            <div className="mt-4 flex justify-center">
              <div className="size-5 animate-spin rounded-full border-2 border-ink border-t-transparent" />
            </div>
          </div>
        )}

        {(step === 'credentials' || step === 'verify-email' || step === 'verify-phone') && (
          <div className="mt-6 flex items-center justify-center gap-2">
            {['credentials', 'verify-email', 'verify-phone'].map((s, i) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  s === step ? 'w-6 bg-ink' : i < ['credentials', 'verify-email', 'verify-phone'].indexOf(step) ? 'w-4 bg-ink/40' : 'w-4 bg-line'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
