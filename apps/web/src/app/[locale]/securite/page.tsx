import { notFound } from 'next/navigation'
import { LOCALES, contentFor, type Locale } from '@/lib/content'
import { CTA, Section, SectionHeading } from '@/components/site-chrome'
import { Reveal } from '@/components/reveal'

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = contentFor(locale)

  return (
    <>
      <Section>
        <Reveal>
          <SectionHeading eyebrow={t.security.eyebrow} title={t.security.title} subtitle={t.security.subtitle} />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {t.security.items.map((item, i) => (
            <Reveal key={item.title} delay={i * 50} distance="sm">
              <article className="mkt-card-lg h-full">
                <h2 className="mkt-h3">{item.title}</h2>
                <p className="mt-3 text-[15px] leading-[1.6] text-slate">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="ink">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mkt-h2 text-balance text-white">{t.finalCta.title}</h2>
            <p className="mt-5 text-[17px] leading-[1.6] text-white/65">{t.finalCta.subtitle}</p>
            <div className="mt-8">
              <CTA href={`/${locale}/demo`} onInk>
                {t.finalCta.cta}
              </CTA>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  )
}
