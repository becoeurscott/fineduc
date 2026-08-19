import { notFound } from 'next/navigation'
import { LOCALES, contentFor, type Locale } from '@/lib/content'
import { CTA, Section, SectionHeading } from '@/components/site-chrome'
import { PrimaryButton, SecondaryButton } from '@/components/hero-buttons'
import { Ticker } from '@/components/ticker'
import { Testimonials } from '@/components/testimonials'
import { Reveal } from '@/components/reveal'
import { BeforeAfter } from '@/components/before-after'
import { DesktopMock } from '@/components/desktop-mock'
import { Clouds, LandscapeSection } from '@/components/landscape'
import { Faq } from '@/components/faq'
import { PricingTable } from '@/components/pricing-table'

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = contentFor(locale)

  return (
    <>
      {/* -------------------------------------------------------------- 1. hero
          Template composition, measured: full-bleed meadow with a wide blue
          sky (z0), cloud cut-outs at the top (z1), CENTERED content on the
          sky (z2) — pill, huge title, subtitle, pill buttons, trust row —
          then the product dashboard over the grass, and a 200px white fade
          into the next section. */}
      <LandscapeSection
        img="/landscape/hero-meadow.jpg"
        priority
        className="pt-24 pb-48 sm:pt-28 lg:pt-[150px] lg:pb-[260px]"
      >
        <Clouds />
        <div className="text-center">
          <Reveal>
            <span className="inline-flex items-center rounded-[var(--radius-mkt-pill)] bg-white/75 px-3.5 py-1.5 text-[13px] font-medium text-slate backdrop-blur">
              {t.hero.eyebrow}
            </span>
            {/* One line. The template stacks "Finance / Platform", but that
                is a two-word name — breaking "Fineduc AI Platform" reads as
                a wrap, not a deliberate stack. `whitespace-nowrap` only from
                the width where it actually fits; below that it may wrap. */}
            <h1 className="mkt-h1 mx-auto mt-6 text-balance lg:whitespace-nowrap">{t.hero.title}</h1>
            {/* Measured: 20px / 500 / slate — the template's value line under the title. */}
            <p className="mx-auto mt-7 max-w-[720px] text-[17px] leading-[1.55] font-medium text-pretty text-slate sm:text-[20px]">
              {t.hero.subtitle}
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <PrimaryButton href={`/${locale}/demo`}>{t.hero.ctaPrimary}</PrimaryButton>
              <SecondaryButton href={`/${locale}#tableau-de-bord`}>{t.hero.ctaSecondary}</SecondaryButton>
            </div>

            {/* Honest claims about how the product works — never invented
                customer counts (see PROOF in lib/content.ts). */}
            <ul className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-2">
              {t.hero.trust.map((item) => (
                <li key={item} className="flex items-center gap-2 text-[16px] font-medium text-slate">
                  <span aria-hidden="true" className="text-positive">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          {/* The whole product, fully visible — no fade cutting through it. */}
          <Reveal delay={140} className="mx-auto mt-16 max-w-[1060px]">
            <DesktopMock locale={locale} />
          </Reveal>
        </div>
      </LandscapeSection>

      {/* ------------------------------------------- 1b. trusted-by ticker
          Template: a single centered line, then a logo row scrolling right
          to left. Tiles are PLACEHOLDERS, labelled as such — real school
          logos imply endorsement and go in only once a school has agreed. */}
      <section className="bg-white px-5 pt-6 pb-20 sm:pb-24">
        <div className="mx-auto max-w-[1200px]">
          <p className="text-center text-[15px] font-medium text-slate">{t.trusted.title}</p>
          <div className="mt-8">
            <Ticker speedSeconds={35} gap="gap-3">
              {t.trusted.placeholders.map((name) => (
                <div
                  key={name}
                  className="flex h-14 w-[180px] shrink-0 items-center justify-center rounded-[14px] border border-dashed border-line bg-[#edf1f4] px-4 text-center text-[12px] font-medium text-slate"
                  title="Emplacement logo — partenaire à confirmer"
                >
                  {name}
                </div>
              ))}
            </Ticker>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- 2. problem → solution */}
      <Section tone="canvas" id="probleme" className="!pt-24 lg:!pt-32">
        <Reveal>
          <SectionHeading eyebrow={t.problem.eyebrow} title={t.problem.title} subtitle={t.problem.subtitle} />
        </Reveal>
        <Reveal delay={80} className="mt-12">
          <BeforeAfter
            beforeLabel={t.problem.beforeLabel}
            afterLabel={t.problem.afterLabel}
            before={t.problem.before}
            after={t.problem.after}
            beforeStats={t.problem.beforeStats}
            afterStats={t.problem.afterStats}
          />
        </Reveal>
      </Section>

      {/* -------------------------------------------------------- 3. features */}
      <Section id="fonctionnalites">
        <Reveal>
          <SectionHeading eyebrow={t.features.eyebrow} title={t.features.title} subtitle={t.features.subtitle} />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.features.items.map((item, i) => (
            <Reveal key={item.title} delay={i * 60}>
              <article className="mkt-card-lg h-full">
                <h3 className="mkt-h3">{item.title}</h3>
                <p className="mt-3 text-[15px] leading-[1.6] text-slate">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------- 4. dashboard showcase
          Template "Overview": rolling-hills landscape, heading on the sky,
          the big dashboard below, white fades on both edges. */}
      <LandscapeSection
        img="/landscape/hills.jpg"
        id="tableau-de-bord"
        fadeTop
        className="py-24 sm:py-32 lg:py-[200px]"
      >
        <Reveal>
          <SectionHeading eyebrow={t.showcase.eyebrow} title={t.showcase.title} subtitle={t.showcase.subtitle} />
        </Reveal>
        <Reveal delay={120} className="mx-auto mt-12 max-w-[1060px]">
          <DesktopMock locale={locale} />
        </Reveal>
        <Reveal delay={160}>
          <dl className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
            {t.showcase.stats.map((stat) => (
              <div key={stat.label} className="rounded-[var(--radius-mkt-card)] bg-white/75 p-4 text-center backdrop-blur">
                <dt className="text-xs text-slate">{stat.label}</dt>
                <dd className="mt-1 text-lg font-semibold tracking-tight text-ink">{stat.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-center text-xs text-ink/60">{t.showcase.caption}</p>
        </Reveal>
      </LandscapeSection>

      {/* ------------------------------------------------------ 5. how it works */}
      <Section tone="canvas">
        <Reveal>
          <SectionHeading eyebrow={t.how.eyebrow} title={t.how.title} />
        </Reveal>
        <ol className="mt-12 grid gap-4 lg:grid-cols-3">
          {t.how.steps.map((step, i) => (
            <Reveal key={step.n} delay={i * 90}>
              <li className="mkt-card-lg h-full bg-white">
                <span className="text-[13px] font-semibold text-slate-muted">{step.n}</span>
                <h3 className="mkt-h3 mt-4">{step.title}</h3>
                <p className="mt-3 text-[15px] leading-[1.6] text-slate">{step.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* ------------------------------------------------------- 6. security */}
      <Section id="securite">
        <Reveal>
          <SectionHeading eyebrow={t.security.eyebrow} title={t.security.title} subtitle={t.security.subtitle} />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.security.items.map((item, i) => (
            <Reveal key={item.title} delay={i * 50}>
              <article className="mkt-card-lg h-full">
                <h3 className="mkt-h3">{item.title}</h3>
                <p className="mt-3 text-[15px] leading-[1.6] text-slate">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------- 7. audience */}
      <Section tone="canvas">
        <Reveal>
          <SectionHeading eyebrow={t.audience.eyebrow} title={t.audience.title} />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.audience.items.map((item, i) => (
            <Reveal key={item.title} delay={i * 60}>
              <article className="mkt-card-lg h-full bg-white">
                <h3 className="mkt-h3">{item.title}</h3>
                <p className="mt-3 text-[15px] leading-[1.6] text-slate">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------ 8 + 9. testimonials
          Template "Testimonial": heading + avatar-card ticker on the
          flower-valley landscape. Driven by PROOF — honestly empty until a
          real director signs off on a quote (see lib/content.ts). */}
      <LandscapeSection img="/landscape/valley.jpg" fadeTop className="py-24 sm:py-32 lg:py-[200px]">
        <Reveal>
          <Testimonials
            eyebrow={t.proof.eyebrow}
            title={t.proof.title}
            emptyBody={t.proof.empty}
            emptyCta={t.proof.cta}
            ctaHref={`/${locale}/demo`}
          />
        </Reveal>
      </LandscapeSection>

      {/* -------------------------------------------------------- 10. pricing */}
      <Section id="tarifs" className="!pt-24 lg:!pt-32">
        <Reveal>
          <SectionHeading eyebrow={t.pricing.eyebrow} title={t.pricing.title} subtitle={t.pricing.subtitle} />
        </Reveal>
        <Reveal delay={80}>
          <PricingTable pricing={t.pricing} ctaHref={`/${locale}/demo`} />
        </Reveal>
      </Section>

      {/* ------------------------------------------------------------ 11. FAQ */}
      <Section tone="canvas">
        <Reveal>
          <SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} />
          <Faq items={t.faq.items} />
        </Reveal>
      </Section>

      {/* ------------------------------------------------------ 12. final CTA
          Template footer: the dusk flower field, content on its pale sky. */}
      <LandscapeSection
        img="/landscape/dusk-field.jpg"
        fadeTop
        fadeBottom={false}
        className="py-28 sm:py-36 lg:py-[220px]"
      >
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mkt-h2 text-balance">{t.finalCta.title}</h2>
            <p className="mt-5 text-[17px] leading-[1.6] text-pretty text-ink/75">{t.finalCta.subtitle}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <CTA href={`/${locale}/demo`}>{t.finalCta.cta}</CTA>
            </div>
          </div>
        </Reveal>
      </LandscapeSection>
    </>
  )
}
