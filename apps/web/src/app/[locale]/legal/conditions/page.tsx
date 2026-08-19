import { notFound } from 'next/navigation'
import { LOCALES, type Locale } from '@/lib/content'
import { Section } from '@/components/site-chrome'

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  return (
    <Section>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {locale === 'fr' ? 'Conditions générales' : 'Terms of service'}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-slate">
          {locale === 'fr'
            ? 'Ce document doit être rédigé avec un conseil juridique avant toute mise en ligne. Il devra décrire précisément les données traitées (élèves, parents payeurs, numéros de téléphone), la base légale du traitement, la durée de conservation, les sous-traitants (agrégateur de paiement, fournisseurs de messagerie, hébergeur) et les modalités d’export et d’effacement.'
            : 'This document must be drafted with legal counsel before going live. It will need to describe precisely what data is processed (students, paying guardians, phone numbers), the lawful basis, retention periods, sub-processors (payment aggregator, messaging providers, hosting) and how export and erasure are handled.'}
        </p>
        <p className="mt-4 rounded-[var(--radius-control)] border border-dashed border-line bg-surface p-4 text-xs text-slate-muted">
          {locale === 'fr'
            ? 'Page volontairement non rédigée. Un texte générique serait inexact et juridiquement risqué.'
            : 'Deliberately not drafted. Generic boilerplate would be inaccurate and legally risky.'}
        </p>
      </div>
    </Section>
  )
}
