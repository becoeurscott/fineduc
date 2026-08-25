'use client'

import { useState } from 'react'

/**
 * The API stores country as CHAR(2) and validates it as exactly two
 * characters, so the option VALUE must be the ISO code — sending the display
 * name ("Cameroun") fails validation with a 422 before anything is created.
 * 'XX' is the ISO user-assigned code for "unspecified"; the API's currency
 * and timezone lookups already fall back to XAF / Africa/Douala for it.
 */
const COUNTRIES = [
  { code: 'CM', fr: 'Cameroun', en: 'Cameroon' },
  { code: 'CI', fr: 'Côte d’Ivoire', en: 'Ivory Coast' },
  { code: 'SN', fr: 'Sénégal', en: 'Senegal' },
  { code: 'CD', fr: 'RDC', en: 'DRC' },
  { code: 'GA', fr: 'Gabon', en: 'Gabon' },
  { code: 'CG', fr: 'Congo', en: 'Congo' },
  { code: 'TD', fr: 'Tchad', en: 'Chad' },
  { code: 'XX', fr: 'Autre', en: 'Other' },
] as const

/**
 * `detail` from the API is written in English for operators. These are the
 * cases a school can actually hit, said in their own language; anything
 * unmapped still falls through to `detail` rather than a generic message.
 */
const ERROR_COPY: Record<string, { fr: string; en: string }> = {
  EMAIL_TAKEN: {
    fr: 'Un compte existe déjà avec cette adresse e-mail. Connectez-vous plutôt.',
    en: 'An account already exists with this email address. Sign in instead.',
  },
  REQUEST_PENDING: {
    fr: 'Une demande pour cette adresse est déjà en cours de validation. Nous vous répondons sous 24 heures.',
    en: 'A request for this address is already under review. We will get back to you within 24 hours.',
  },
}

/**
 * The API speaks RFC 9457 problem+json: the reason is in `detail`, the stable
 * reason code in `code`, and Zod field failures in `errors`. A plain
 * `body.message` read is always undefined, which is what turned "this email
 * is already used" into a bare "Erreur serveur".
 */
function apiErrorMessage(body: unknown, locale: 'fr' | 'en', fallback: string): string {
  const problem = body as {
    detail?: string
    message?: string
    code?: string
    errors?: Array<{ path?: string; message?: string }>
  } | null

  const known = problem?.code ? ERROR_COPY[problem.code] : undefined
  if (known) return known[locale]

  const fieldErrors = problem?.errors
    ?.map((issue) => [issue.path, issue.message].filter(Boolean).join(': '))
    .filter(Boolean)

  if (fieldErrors?.length) return fieldErrors.join(' · ')
  return problem?.detail ?? problem?.message ?? fallback
}

const COPY = {
  fr: {
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
    submit: 'Envoyer ma demande',
    sending: 'Envoi en cours…',
    successTitle: 'Demande envoyée !',
    successLead: 'Nous avons bien reçu la demande de',
    successBody:
      'Notre équipe la vérifie sous 24 heures. Dès qu’elle est validée, vous recevez vos identifiants de connexion par WhatsApp au numéro que vous venez d’indiquer.',
    successNote: 'Aucune action de votre part pour l’instant — gardez simplement votre WhatsApp à portée de main.',
    steps: ['Votre demande', 'Validation', 'Vos accès'],
  },
  en: {
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
    submit: 'Send my request',
    sending: 'Sending…',
    successTitle: 'Request sent!',
    successLead: 'We have received the request for',
    successBody:
      'Our team reviews it within 24 hours. Once approved, you will receive your sign-in details on WhatsApp, at the number you just gave us.',
    successNote: 'Nothing to do for now — just keep an eye on your WhatsApp.',
    steps: ['Your request', 'Review', 'Your access'],
  },
} as const

export function SignupForm({ locale }: { locale: 'fr' | 'en' }) {
  const c = COPY[locale]
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({
    school: '',
    name: '',
    role: c.roles[0] as string,
    email: '',
    phone: '',
    students: '',
    country: COUNTRIES[0].code as string,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const field =
    'h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate-muted focus:border-accent focus:outline-none'

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'

  async function handleSubmit() {
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
        throw new Error(
          apiErrorMessage(
            body,
            locale,
            locale === 'fr' ? 'Erreur serveur' : 'Server error',
          ),
        )
      }
      setSubmitted(true)
    } catch (err) {
      const networkFallback = locale === 'fr' ? 'Erreur réseau' : 'Network error'
      setError(err instanceof Error ? err.message : networkFallback)
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

  /*
   * The step rail is informational, not navigational: the school completes
   * step 1 and then waits on us. Showing all three keeps the wait from
   * reading as "nothing happened" — the reason step 2 is highlighted rather
   * than ticked once the request is in.
   */
  const activeStep = submitted ? 1 : 0

  return (
    <div className="mt-8">
      <div className="mb-8 flex items-center justify-center gap-2">
        {c.steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${
                  i <= activeStep ? 'bg-ink text-white' : 'bg-[#edf1f4] text-slate'
                }`}
              >
                {i < activeStep ? '✓' : i + 1}
              </span>
              <span
                className={`hidden text-xs font-medium sm:inline ${
                  i <= activeStep ? 'text-ink' : 'text-slate-muted'
                }`}
              >
                {label}
              </span>
            </div>
            {i < c.steps.length - 1 && (
              <div className={`h-px w-8 sm:w-12 ${i < activeStep ? 'bg-ink' : 'bg-[#dde5ed]'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {submitted ? (
        <div className="mx-auto max-w-md py-8 text-center">
          <span className="inline-grid size-14 place-items-center rounded-full bg-positive/10 text-3xl text-positive">
            ✓
          </span>
          <h2 className="mt-5 text-lg font-semibold text-ink">{c.successTitle}</h2>
          <p className="mt-2 text-sm text-slate">
            {c.successLead} <span className="font-medium text-ink">{form.school}</span>.
          </p>
          <p className="mt-4 text-sm text-slate">{c.successBody}</p>
          <p className="mt-6 rounded-lg bg-[#edf1f4] px-4 py-3 text-xs text-slate">{c.successNote}</p>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.school}</span>
              <input
                required
                value={form.school}
                onChange={set('school')}
                className={field}
                placeholder={c.schoolPlaceholder}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.name}</span>
              <input
                required
                value={form.name}
                onChange={set('name')}
                className={field}
                placeholder={c.namePlaceholder}
              />
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
              <input
                required
                type="email"
                value={form.email}
                onChange={set('email')}
                className={field}
                placeholder={c.emailPlaceholder}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.phone}</span>
              <input
                required
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={set('phone')}
                className={field}
                placeholder={c.phonePlaceholder}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.students}</span>
              <input
                inputMode="numeric"
                value={form.students}
                onChange={set('students')}
                className={field}
                placeholder={c.studentsPlaceholder}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate">{c.country}</span>
              <select value={form.country} onChange={set('country')} className={field}>
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country[locale]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={
              loading ||
              !form.school.trim() ||
              !form.name.trim() ||
              !form.email.trim() ||
              !form.phone.trim()
            }
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-[#323232] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {loading && spinner}
            {loading ? c.sending : c.submit}
          </button>
        </form>
      )}
    </div>
  )
}
