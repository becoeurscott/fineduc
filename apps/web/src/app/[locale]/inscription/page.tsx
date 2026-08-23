import { notFound } from 'next/navigation'
import { LOCALES, contentFor, type Locale } from '@/lib/content'
import { Section } from '@/components/site-chrome'
import { Reveal } from '@/components/reveal'
import { SignupForm } from '@/components/signup-form'

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export default async function SignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = contentFor(locale)

  return (
    <Section>
      <div className="mx-auto max-w-2xl">
        <Reveal>
          <h1 className="mkt-h2 text-balance">{t.finalCta.title}</h1>
          <p className="mt-5 text-[17px] leading-[1.6] text-slate">{t.finalCta.subtitle}</p>
          <SignupForm locale={locale} />
        </Reveal>
      </div>
    </Section>
  )
}
