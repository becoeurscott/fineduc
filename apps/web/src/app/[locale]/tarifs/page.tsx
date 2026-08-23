import { notFound } from 'next/navigation'
import { LOCALES, contentFor, type Locale } from '@/lib/content'
import { Section, SectionHeading } from '@/components/site-chrome'
import { Reveal } from '@/components/reveal'
import { PricingTable } from '@/components/pricing-table'
import { Faq } from '@/components/faq'

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = contentFor(locale)

  // The money questions only — the full FAQ lives on the home page.
  const pricingFaq = t.faq.items.filter((item) =>
    /argent|money|commission|frais|fees|Excel|données|data/i.test(item.q + item.a),
  )

  return (
    <>
      <Section>
        <Reveal>
          <SectionHeading eyebrow={t.pricing.eyebrow} title={t.pricing.title} subtitle={t.pricing.subtitle} />
        </Reveal>
        <Reveal delay={80}>
          <PricingTable pricing={t.pricing} ctaHref={`/${locale}/inscription`} />
        </Reveal>
      </Section>

      {pricingFaq.length > 0 ? (
        <Section tone="canvas">
          <Reveal>
            <SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} />
            <Faq items={pricingFaq} />
          </Reveal>
        </Section>
      ) : null}
    </>
  )
}
