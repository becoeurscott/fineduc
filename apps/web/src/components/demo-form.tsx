'use client'

import { useState } from 'react'
import { WHATSAPP_NUMBER } from '@/lib/content'

/**
 * Demo request.
 *
 * There is no lead-capture endpoint yet (no CRM, and the API is on phase 2
 * of ARCHITECTURE.md §15), so this deliberately does NOT post to a server
 * that would drop the enquiry on the floor. Instead it composes a WhatsApp
 * message with everything the user typed and hands off to WhatsApp — which
 * is how these buyers make contact anyway (PRD §8).
 *
 * That means the enquiry genuinely reaches a human, and the user can see
 * exactly what is being sent before it goes. When a real endpoint exists,
 * swap the submit handler; the fields already match what sales needs.
 */
const COPY = {
  fr: {
    school: 'Nom de l’établissement',
    name: 'Votre nom',
    role: 'Votre fonction',
    phone: 'Téléphone (WhatsApp)',
    students: 'Nombre d’élèves',
    message: 'Votre situation en une phrase',
    messagePlaceholder: 'Ex. : nous perdons environ 4 millions d’arriérés par an.',
    submit: 'Continuer sur WhatsApp',
    note: 'Le bouton ouvre WhatsApp avec votre message pré-rempli. Vous pouvez le relire avant d’envoyer.',
    roles: ['Directeur / Promoteur', 'Économe / Comptable', 'Secrétaire', 'Autre'],
  },
  en: {
    school: 'School name',
    name: 'Your name',
    role: 'Your role',
    phone: 'Phone (WhatsApp)',
    students: 'Number of students',
    message: 'Your situation in one sentence',
    messagePlaceholder: 'e.g. we write off around 4 million in arrears every year.',
    submit: 'Continue on WhatsApp',
    note: 'This opens WhatsApp with your message pre-filled. You can read it before sending.',
    roles: ['Director / Proprietor', 'Bursar / Accountant', 'Secretary', 'Other'],
  },
} as const

export function DemoForm({ locale }: { locale: 'fr' | 'en' }) {
  const c = COPY[locale]
  const [form, setForm] = useState({ school: '', name: '', role: c.roles[0], phone: '', students: '', message: '' })

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const body =
    locale === 'fr'
      ? `Bonjour Fineduc, je souhaite une démonstration.\n\nÉtablissement : ${form.school}\nNom : ${form.name}\nFonction : ${form.role}\nTéléphone : ${form.phone}\nÉlèves : ${form.students}\n\n${form.message}`
      : `Hello Fineduc, I would like a demonstration.\n\nSchool: ${form.school}\nName: ${form.name}\nRole: ${form.role}\nPhone: ${form.phone}\nStudents: ${form.students}\n\n${form.message}`

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(body)}`
  const ready = form.school.trim() !== '' && form.name.trim() !== ''

  const field = 'h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate-muted focus:border-accent focus:outline-none'

  return (
    <form
      className="mt-8 space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate">{c.school}</span>
          <input required value={form.school} onChange={set('school')} className={field} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate">{c.name}</span>
          <input required value={form.name} onChange={set('name')} className={field} />
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
          <span className="mb-1.5 block text-xs font-medium text-slate">{c.phone}</span>
          <input type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} className={field} placeholder="+237 6.." />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-slate">{c.students}</span>
          <input inputMode="numeric" value={form.students} onChange={set('students')} className={field} placeholder="400" />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-slate">{c.message}</span>
        <textarea
          value={form.message}
          onChange={set('message')}
          rows={3}
          placeholder={c.messagePlaceholder}
          className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-slate-muted focus:border-accent focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={!ready}
        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-positive px-6 text-sm font-medium text-white transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {c.submit}
      </button>
      <p className="text-xs text-slate-muted">{c.note}</p>
    </form>
  )
}
