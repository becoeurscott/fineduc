import { Ticker } from './ticker'
import { CTA } from './site-chrome'
import { PROOF } from '@/lib/content'

/**
 * The template's "Testimonial" section: a heading ("What investors say
 * about the platform"), then a right-to-left TICKER of cards, each with a
 * 5-star row, a quote, and a 50px avatar with name and role.
 *
 * Same layout here, for DIRECTORS — but it renders from `PROOF`, which
 * is deliberately empty. Fineduc has no customers yet, so there is no
 * "investor" or "director" quote to show, and inventing one on a public
 * page would be fabricated social proof. Until a real school signs off on
 * exact wording, this shows the honest empty state in the same visual
 * slot, so the page's rhythm is already right and filling it later is a
 * data change, not a layout change.
 */
export function Testimonials({
  eyebrow,
  title,
  emptyBody,
  emptyCta,
  ctaHref,
}: {
  eyebrow: string
  title: string
  emptyBody: string
  emptyCta: string
  ctaHref: string
}) {
  const quotes = PROOF.testimonials

  return (
    <div className="text-center">
      <span className="inline-flex items-center gap-1.5 rounded-[100px] bg-white/80 px-3.5 py-1.5 text-[13px] font-medium text-slate backdrop-blur">
        {eyebrow}
      </span>
      <h2 className="mkt-h2 mx-auto mt-5 max-w-[640px] text-balance">{title}</h2>

      {quotes.length === 0 ? (
        <div className="mx-auto mt-10 max-w-2xl rounded-[20px] bg-white/85 p-10 backdrop-blur">
          <p className="text-[15px] leading-relaxed text-slate">{emptyBody}</p>
          <div className="mt-6">
            <CTA href={ctaHref}>{emptyCta}</CTA>
          </div>
        </div>
      ) : (
        <div className="mt-12 -mx-5">
          <Ticker speedSeconds={55} gap="gap-5" className="px-5">
            {quotes.map((q) => (
              <figure key={q.author} className="w-[360px] shrink-0 rounded-[20px] bg-white p-7 text-left shadow-[var(--shadow-card)]">
                <div aria-label="5 sur 5" className="flex gap-0.5 text-[#f59e0b]">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg key={i} viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
                      <path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L10 14.9l-5.3 2.8 1.1-5.9L1.5 7.7l5.9-.8z" />
                    </svg>
                  ))}
                </div>
                <blockquote className="mt-4 text-[15px] leading-[1.6] text-ink">“{q.quote}”</blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-[50px] shrink-0 place-items-center rounded-full bg-[#edf1f4] text-sm font-semibold text-ink"
                  >
                    {q.author
                      .split(' ')
                      .map((w) => w[0])
                      .join('')
                      .slice(0, 2)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{q.author}</span>
                    <span className="block truncate text-xs text-slate">
                      {q.role}, {q.school}
                    </span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </Ticker>
        </div>
      )}
    </div>
  )
}
