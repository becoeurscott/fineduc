'use client'

import { useState } from 'react'

const COPY = {
  fr: {
    steps: ['Votre école', 'Vérification', 'Mot de passe'],
    school: 'Nom de l’établissement',
    schoolPlaceholder: 'Ex. : École Bilingue Excellence',
    name: 'Votre nom complet',
    namePlaceholder: 'Jean Mballa',
    role: 'Votre fonction',
    roles: ['Directeur / Promoteur', 'Économe / Comptable', 'Secrétaire', 'Autre'] as const,
    email: 'Adresse e-mail',
    emailPlaceholder: 'directeur@excellence.cm',
    phone: 'Téléphone (WhatsApp)',
    phonePlaceholder: '+237 6 99 12 34 56',
    students: 'Nombre d’élèves (approximatif)',
    studentsPlaceholder: '400',
    country: 'Pays',
    countries: ['Cameroun', 'Côte d’Ivoire', 'Sénégal', 'RDC', 'Gabon', 'Congo', 'Tchad', 'Autre'] as const,
    next: 'Continuer',
    verifyTitle: 'Vérifiez votre e-mail',
    verifySubtitle: 'Nous avons envoyé un code à 6 chiffres à',
    code: 'Code de vérification',
    codePlaceholder: '000000',
    resend: 'Renvoyer le code',
    phoneVerifyTitle: 'Vérifiez votre téléphone',
    phoneVerifySubtitle: 'Nous avons envoyé un SMS à',
    passwordTitle: 'Créez votre mot de passe',
    passwordSubtitle: 'Ce mot de passe protège votre compte directeur.',
    password: 'Mot de passe',
    passwordConfirm: 'Confirmer le mot de passe',
    passwordHint: 'Au moins 8 caractères',
    submit: 'Créer mon école',
    success: 'Votre école est créée !',
    successSubtitle: 'Vous allez être redirigé vers votre tableau de bord.',
    redirecting: 'Redirection en cours...',
  },
  en: {
    steps: ['Your school', 'Verification', 'Password'],
    school: 'School name',
    schoolPlaceholder: 'e.g. Bilingual Excellence Academy',
    name: 'Your full name',
    namePlaceholder: 'John Smith',
    role: 'Your role',
    roles: ['Director / Proprietor', 'Bursar / Accountant', 'Secretary', 'Other'] as const,
    email: 'Email address',
    emailPlaceholder: 'director@excellence.cm',
    phone: 'Phone (WhatsApp)',
    phonePlaceholder: '+237 6 99 12 34 56',
    students: 'Number of students (approximate)',
    studentsPlaceholder: '400',
    country: 'Country',
    countries: ['Cameroon', 'Ivory Coast', 'Senegal', 'DRC', 'Gabon', 'Congo', 'Chad', 'Other'] as const,
    next: 'Continue',
    verifyTitle: 'Verify your email',
    verifySubtitle: 'We sent a 6-digit code to',
    code: 'Verification code',
    codePlaceholder: '000000',
    resend: 'Resend code',
    phoneVerifyTitle: 'Verify your phone',
    phoneVerifySubtitle: 'We sent an SMS to',
    passwordTitle: 'Create your password',
    passwordSubtitle: 'This password protects your director account.',
    password: 'Password',
    passwordConfirm: 'Confirm password',
    passwordHint: 'At least 8 characters',
    submit: 'Create my school',
    success: 'Your school is created!',
    successSubtitle: 'You will be redirected to your dashboard.',
    redirecting: 'Redirecting...',
  },
} as const

type Step = 0 | 1 | 2 | 3 | 4

export function SignupForm({ locale }: { locale: 'fr' | 'en' }) {
  const c = COPY[locale]
  const [step, setStep] = useState<Step>(0)
  const [form, setForm] = useState({
    school: '',
    name: '',
    role: c.roles[0] as string,
    email: '',
    phone: '',
    students: '',
    country: c.countries[0] as string,
  })
  const [emailCode, setEmailCode] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const field = 'h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate-muted focus:border-accent focus:outline-none'

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'

  async function handleStep0() {
    if (!form.school.trim() || !form.name.trim() || !form.email.trim() || !form.phone.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/auth/signup/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolName: form.school,
          contactName: form.name,
          role: form.role,
          email: form.email,
          phone: form.phone,
          studentCount: form.students ? Number(form.students) : undefined,
          country: form.country,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? 'Erreur serveur')
      }
      setStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailVerify() {
    if (emailCode.length !== 6) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/auth/signup/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, code: emailCode }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? 'Code invalide')
      }
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  async function handlePhoneVerify() {
    if (phoneCode.length !== 6) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/auth/signup/verify-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, code: phoneCode }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? 'Code invalide')
      }
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateAccount() {
    if (password.length < 8 || password !== passwordConfirm) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/auth/signup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? 'Erreur serveur')
      }
      setStep(4)
      const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3020/login'
      setTimeout(() => {
        window.location.href = dashboardUrl
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  async function handleResendEmail() {
    setLoading(true)
    setError('')
    try {
      await fetch(`${apiUrl}/auth/signup/resend-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      })
    } catch {
      // silent — the user can try again
    } finally {
      setLoading(false)
    }
  }

  async function handleResendPhone() {
    setLoading(true)
    setError('')
    try {
      await fetch(`${apiUrl}/auth/signup/resend-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone }),
      })
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  const spinner = (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )

  const stepIndex = Math.min(step, 3)
  const stepLabels = c.steps

  return (
    <div className="mt-8">
      {/* Step indicator */}
      {step < 4 && (
        <div className="mb-8 flex items-center justify-center gap-2">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${
                    i <= stepIndex
                      ? 'bg-ink text-white'
                      : 'bg-[#edf1f4] text-slate'
                  }`}
                >
                  {i < stepIndex ? '✓' : i + 1}
                </span>
                <span className={`hidden text-xs font-medium sm:inline ${i <= stepIndex ? 'text-ink' : 'text-slate-muted'}`}>
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <div className={`h-px w-8 sm:w-12 ${i < stepIndex ? 'bg-ink' : 'bg-[#dde5ed]'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* Step 0: School info */}
      {step === 0 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleStep0()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.school}</span>
              <input required value={form.school} onChange={set('school')} className={field} placeholder={c.schoolPlaceholder} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.name}</span>
              <input required value={form.name} onChange={set('name')} className={field} placeholder={c.namePlaceholder} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.role}</span>
              <select value={form.role} onChange={set('role')} className={field}>
                {c.roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.email}</span>
              <input required type="email" value={form.email} onChange={set('email')} className={field} placeholder={c.emailPlaceholder} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.phone}</span>
              <input required type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} className={field} placeholder={c.phonePlaceholder} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.students}</span>
              <input inputMode="numeric" value={form.students} onChange={set('students')} className={field} placeholder={c.studentsPlaceholder} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.country}</span>
              <select value={form.country} onChange={set('country')} className={field}>
                {c.countries.map((country) => (
                  <option key={country}>{country}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={loading || !form.school.trim() || !form.name.trim() || !form.email.trim() || !form.phone.trim()}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-[#323232] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {loading && spinner}
            {c.next}
          </button>
        </form>
      )}

      {/* Step 1: Email verification */}
      {step === 1 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleEmailVerify()
          }}
        >
          <div className="text-center">
            <h2 className="text-lg font-semibold text-ink">{c.verifyTitle}</h2>
            <p className="mt-1 text-sm text-slate">
              {c.verifySubtitle} <span className="font-medium text-ink">{form.email}</span>
            </p>
          </div>
          <label className="mx-auto block max-w-xs">
            <span className="mb-1.5 block text-center text-xs font-medium text-slate">{c.code}</span>
            <input
              required
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${field} text-center text-lg tracking-[0.3em]`}
              placeholder={c.codePlaceholder}
              autoFocus
            />
          </label>
          <div className="flex flex-col items-center gap-3">
            <button
              type="submit"
              disabled={loading || emailCode.length !== 6}
              className="inline-flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-[#323232] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && spinner}
              {c.next}
            </button>
            <button type="button" onClick={handleResendEmail} disabled={loading} className="text-xs text-slate hover:text-ink">
              {c.resend}
            </button>
          </div>
        </form>
      )}

      {/* Step 2: Phone verification */}
      {step === 2 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handlePhoneVerify()
          }}
        >
          <div className="text-center">
            <h2 className="text-lg font-semibold text-ink">{c.phoneVerifyTitle}</h2>
            <p className="mt-1 text-sm text-slate">
              {c.phoneVerifySubtitle} <span className="font-medium text-ink">{form.phone}</span>
            </p>
          </div>
          <label className="mx-auto block max-w-xs">
            <span className="mb-1.5 block text-center text-xs font-medium text-slate">{c.code}</span>
            <input
              required
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={phoneCode}
              onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${field} text-center text-lg tracking-[0.3em]`}
              placeholder={c.codePlaceholder}
              autoFocus
            />
          </label>
          <div className="flex flex-col items-center gap-3">
            <button
              type="submit"
              disabled={loading || phoneCode.length !== 6}
              className="inline-flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-[#323232] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && spinner}
              {c.next}
            </button>
            <button type="button" onClick={handleResendPhone} disabled={loading} className="text-xs text-slate hover:text-ink">
              {c.resend}
            </button>
          </div>
        </form>
      )}

      {/* Step 3: Password */}
      {step === 3 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleCreateAccount()
          }}
        >
          <div className="text-center">
            <h2 className="text-lg font-semibold text-ink">{c.passwordTitle}</h2>
            <p className="mt-1 text-sm text-slate">{c.passwordSubtitle}</p>
          </div>
          <div className="mx-auto max-w-sm space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.password}</span>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
                autoFocus
              />
              <span className="mt-1 block text-xs text-slate-muted">{c.passwordHint}</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.passwordConfirm}</span>
              <input
                required
                type="password"
                minLength={8}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className={field}
              />
            </label>
          </div>
          <div className="flex justify-center">
            <button
              type="submit"
              disabled={loading || password.length < 8 || password !== passwordConfirm}
              className="inline-flex h-12 w-full max-w-sm items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-[#323232] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && spinner}
              {c.submit}
            </button>
          </div>
        </form>
      )}

      {/* Step 4: Success */}
      {step === 4 && (
        <div className="py-12 text-center">
          <span className="text-5xl">✓</span>
          <h2 className="mt-4 text-lg font-semibold text-ink">{c.success}</h2>
          <p className="mt-2 text-sm text-slate">{c.successSubtitle}</p>
          <p className="mt-4 text-xs text-slate-muted">{c.redirecting}</p>
        </div>
      )}
    </div>
  )
}
