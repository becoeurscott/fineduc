import Link from 'next/link'
import clsx from 'clsx'
import { WHATSAPP_URL, contentFor, type Locale } from '@/lib/content'

/* ------------------------------------------------------------- layout bits */

/**
 * Measured off the template: a 1200px content column, and 200px of
 * vertical section padding on desktop. That generosity is most of what
 * makes the original feel expensive — tightening it to a conventional
 * 96px is the single change that would make this read as a knock-off.
 * Scaled down on small screens, where 200px would just be dead space.
 */
export function Section({
  children,
  className,
  id,
  tone = 'white',
}: {
  children: React.ReactNode
  className?: string
  id?: string
  tone?: 'white' | 'canvas' | 'ink'
}) {
  return (
    <section
      id={id}
      data-section=""
      className={clsx(
        // scroll-mt: the nav is fixed, so an #anchor jump would otherwise
        // park the section heading underneath the pill.
        'scroll-mt-[84px] px-5 py-20 sm:py-28 lg:py-[200px]',
        tone === 'white' && 'bg-white',
        tone === 'canvas' && 'bg-[#edf1f4]',
        tone === 'ink' && 'bg-black text-white',
        className,
      )}
    >
      <div className="mx-auto max-w-[1200px]">{children}</div>
    </section>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
  onInk = false,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  align?: 'center' | 'left'
  onInk?: boolean
}) {
  return (
    <div className={clsx('max-w-[640px]', align === 'center' && 'mx-auto text-center')}>
      {eyebrow ? (
        // The template's section labels are a small pill, not bare text.
        <span
          className={clsx(
            'inline-flex items-center rounded-[var(--radius-mkt-pill)] px-3.5 py-1.5 text-[13px] font-medium',
            onInk ? 'bg-white/10 text-white/80' : 'bg-[#edf1f4] text-slate',
          )}
        >
          {eyebrow}
        </span>
      ) : null}
      <h2 className={clsx('mkt-h2 mt-5 text-balance', onInk && 'text-white')}>{title}</h2>
      {subtitle ? (
        <p className={clsx('mt-5 text-[17px] leading-[1.6] text-pretty', onInk ? 'text-white/65' : 'text-slate')}>
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}

export function CTA({
  href,
  children,
  variant = 'primary',
  onInk = false,
}: {
  href: string
  children: React.ReactNode
  variant?: 'primary' | 'secondary'
  onInk?: boolean
}) {
  return (
    <Link
      href={href}
      className={clsx(
        // Measured: 49px tall, fully pill (100px radius). Also a comfortable
        // thumb target, which matters more than the mouse case here.
        'inline-flex h-[49px] items-center justify-center rounded-[var(--radius-mkt-pill)] px-6 text-[15px] font-medium transition-colors',
        variant === 'primary' && (onInk ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-[#323232]'),
        variant === 'secondary' &&
          (onInk ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-[#edf1f4] text-ink hover:bg-[#dde5ed]'),
      )}
    >
      {children}
    </Link>
  )
}

/* ---------------------------------------------------------------- header */

/**
 * Progressive blur, measured off the template: eight stacked layers, each
 * doubling the blur radius (0.078125px → 10px) and each masked to a band
 * that slides 12.5% further up than the last. A single `backdrop-blur`
 * would give a hard edge where the strip ends; this ramps the blur so
 * content dissolves into the top of the page instead of hitting a line.
 *
 * 100px tall against the nav's 84px — deliberately taller, so the ramp
 * finishes below the pill rather than level with it.
 */
const BLUR_RADII = [0.078125, 0.15625, 0.3125, 0.625, 1.25, 2.5, 5, 10]

function maskFor(layer: number) {
  const start = layer * 12.5
  const stops = [
    `rgba(0,0,0,0) ${start}%`,
    `rgb(0,0,0) ${start + 12.5}%`,
    `rgb(0,0,0) ${start + 25}%`,
    `rgba(0,0,0,0) ${start + 37.5}%`,
  ].filter((_, i) => start + i * 12.5 <= 100)
  return `linear-gradient(to top, ${stops.join(', ')})`
}

function ProgressiveBlur() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[100px]">
      {BLUR_RADII.map((radius, i) => (
        <div
          key={radius}
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${radius}px)`,
            WebkitBackdropFilter: `blur(${radius}px)`,
            maskImage: maskFor(i),
            WebkitMaskImage: maskFor(i),
          }}
        />
      ))}
    </div>
  )
}

export function SiteHeader({ locale }: { locale: Locale }) {
  const t = contentFor(locale)
  const other: Locale = locale === 'fr' ? 'en' : 'fr'

  return (
    /*
      Measured off the template: the nav is not a bar, it is a pill that
      floats clear of every edge — 16px of transparent gutter above it, and
      centred well inside the 1200px column. Solid white pill + a 2px
      #dde5ed ring, no blur on the pill itself.

      `fixed`, not `sticky`: the page has to run underneath the nav all the
      way to y=0, otherwise the header reserves its own 84px band and the
      hero can never reach the top of the screen. The blur below sits
      between that content and the pill.
    */
    <header className="fixed inset-x-0 top-0 z-40 px-5 py-4">
      <ProgressiveBlur />
      <div className="relative mx-auto flex h-[52px] max-w-[1080px] items-center justify-between gap-5 rounded-[10px] bg-white px-2.5 shadow-[0_0_0_2px_rgba(221,229,237,0.7)]">
        <Link href={`/${locale}`} className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-ink text-sm font-bold text-white">F</span>
          <span className="hidden text-base font-semibold tracking-tight text-ink min-[400px]:inline">Fineduc</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Principal">
          <Link href={`/${locale}#fonctionnalites`} className="text-sm text-slate transition-colors hover:text-ink">
            {t.nav.features}
          </Link>
          <Link href={`/${locale}/tarifs`} className="text-sm text-slate transition-colors hover:text-ink">
            {t.nav.pricing}
          </Link>
          <Link href={`/${locale}/securite`} className="text-sm text-slate transition-colors hover:text-ink">
            {t.nav.security}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={`/${other}`}
            hrefLang={other}
            className="rounded-[var(--radius-mkt-pill)] bg-[#edf1f4] px-3 py-1.5 text-xs font-medium text-slate transition-colors hover:text-ink"
          >
            {other.toUpperCase()}
          </Link>
          <Link
            href={`/${locale}/demo`}
            // 32px, matching the template's menu button — that is all the
            // height a 52px pill with 10px padding leaves.
            className="inline-flex h-8 items-center rounded-[var(--radius-mkt-pill)] bg-black px-4 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-[#323232]"
          >
            <span className="sm:hidden">{t.nav.demoShort}</span>
            <span className="hidden sm:inline">{t.nav.demo}</span>
          </Link>
        </div>
      </div>
    </header>
  )
}

/* ---------------------------------------------------------------- footer */

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = contentFor(locale)
  const year = 2026

  return (
    <footer className="bg-white px-5 pb-14">
      <div className="mx-auto max-w-[1200px] rounded-[var(--radius-mkt-card)] bg-[#edf1f4] p-8 sm:p-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-ink text-sm font-bold text-white">F</span>
              <span className="text-base font-semibold tracking-tight text-ink">Fineduc</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate">{t.footer.tagline}</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-[0.14em] text-slate uppercase">{t.footer.product}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href={`/${locale}#fonctionnalites`} className="text-slate hover:text-ink">
                  {t.nav.features}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/tarifs`} className="text-slate hover:text-ink">
                  {t.nav.pricing}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/securite`} className="text-slate hover:text-ink">
                  {t.nav.security}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-[0.14em] text-slate uppercase">{t.footer.legal}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href={`/${locale}/legal/confidentialite`} className="text-slate hover:text-ink">
                  {t.footer.privacy}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/legal/conditions`} className="text-slate hover:text-ink">
                  {t.footer.terms}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/*
          Stated plainly in the footer of every page, not buried in the FAQ.
          It is the single most important thing a sceptical director needs to
          believe, and PRD §4 makes it a hard product boundary.
        */}
        <p className="mt-10 border-t border-[#dde5ed] pt-6 text-xs leading-relaxed text-slate-muted">
          {t.footer.notPaymentInstitution}
        </p>
        <p className="mt-2 text-xs text-slate-muted">
          © {year} Fineduc. {t.footer.rights}
        </p>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------- WhatsApp button */

/**
 * On every page (PRD §8) — WhatsApp is how these buyers actually make
 * contact. `bottom-20` on small screens keeps it clear of browser chrome.
 */
export function WhatsAppButton({ label }: { label: string }) {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="fixed right-4 bottom-5 z-50 inline-flex h-13 items-center gap-2 rounded-full bg-positive px-4 py-3.5 text-sm font-medium text-white shadow-[var(--shadow-raised)] transition-transform hover:scale-[1.03] sm:right-6 sm:bottom-6"
    >
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.88 1.21 3.08c.15.2 2.09 3.2 5.08 4.48.71.31 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2z" />
      </svg>
      <span className="hidden sm:inline">WhatsApp</span>
    </a>
  )
}
