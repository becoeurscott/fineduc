import Link from 'next/link'
import clsx from 'clsx'
import { CountUp } from './count-up'
/**
 * Typed structurally rather than as `CONTENT['fr']['pricing']`.
 *
 * The content module is `as const`, so each locale's copy has its own
 * literal types ("Tarifs" vs "Pricing") and they are not mutually
 * assignable. Describing the SHAPE the component needs keeps it working
 * for every locale, and means adding a third language never touches this
 * file.
 */
type Pricing = {
  readonly monthly: string
  readonly annual: string
  readonly perMonth: string
  readonly cta: string
  readonly mostPopular: string
  readonly plans: readonly {
    readonly name: string
    readonly audience: string
    readonly monthly: string
    readonly annual: string
    readonly highlighted?: boolean
    readonly fromPrefix?: string
    readonly features: readonly string[]
  }[]
  readonly walletTitle: string
  readonly walletBody: string
  readonly onboardingTitle: string
  readonly onboardingBody: string
  readonly feesNote: string
}

/**
 * The pricing table (PRD §7).
 *
 * MONTHLY ONLY, for now. The table used to default to an annual tab at −20 %,
 * which PRD §7 expects most revenue to come from — but there is no annual
 * product to sell: Chariow charges a pre-priced product and only the three
 * monthly ones exist, so the checkout refuses an annual period outright.
 *
 * A page quoting the cheaper annual figure by default was therefore
 * advertising a price nobody could be charged. The plans keep their `annual`
 * copy so restoring the toggle is a matter of putting this markup back once
 * the annual products exist.
 */
export function PricingTable({ pricing, ctaHref }: { pricing: Pricing; ctaHref: string }) {
  return (
    <div className="mt-10">
      <div className="grid gap-4 lg:grid-cols-3">
        {pricing.plans.map((plan) => {
          const highlighted = 'highlighted' in plan && plan.highlighted
          const fromPrefix = 'fromPrefix' in plan ? plan.fromPrefix : undefined
          return (
            <article
              key={plan.name}
              className={clsx(
                'relative flex flex-col rounded-[var(--radius-mkt-card)] p-10',
                highlighted ? 'bg-black text-white' : 'bg-[#edf1f4]',
              )}
            >
              {highlighted ? (
                <span className="absolute -top-3 left-6 rounded-full bg-positive px-3 py-1 text-[11px] font-medium text-white">
                  {pricing.mostPopular}
                </span>
              ) : null}

              <h3 className={clsx('mkt-h3', highlighted && 'text-white')}>{plan.name}</h3>
              <p className={clsx('mt-1.5 text-[15px]', highlighted ? 'text-white/60' : 'text-slate')}>{plan.audience}</p>

              <div className="mt-5">
                {fromPrefix ? (
                  <span className={clsx('block text-xs', highlighted ? 'text-white/60' : 'text-slate')}>
                    {fromPrefix}
                  </span>
                ) : null}
                <span
                  className={clsx(
                    'text-[44px] font-semibold tracking-[-1px] leading-none',
                    highlighted ? 'text-white' : 'text-ink',
                  )}
                >
                  <CountUp value={plan.monthly} />
                </span>
                <span className={clsx('ml-1.5 text-sm', highlighted ? 'text-white/60' : 'text-slate')}>
                  FCFA {pricing.perMonth}
                </span>
              </div>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-[15px]">
                    <span
                      aria-hidden="true"
                      className={clsx('mt-0.5 shrink-0', highlighted ? 'text-positive' : 'text-positive')}
                    >
                      ✓
                    </span>
                    <span className={highlighted ? 'text-white/85' : 'text-slate'}>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={ctaHref}
                className={clsx(
                  'mt-8 inline-flex h-[49px] items-center justify-center rounded-[var(--radius-mkt-pill)] px-6 text-[15px] font-medium transition-colors',
                  highlighted ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-[#323232]',
                )}
              >
                {pricing.cta}
              </Link>
            </article>
          )
        })}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="mkt-card-lg">
          <h3 className="mkt-h3">{pricing.walletTitle}</h3>
          <p className="mt-3 text-[15px] leading-[1.6] text-slate">{pricing.walletBody}</p>
        </div>
        <div className="mkt-card-lg">
          <h3 className="mkt-h3">{pricing.onboardingTitle}</h3>
          <p className="mt-3 text-[15px] leading-[1.6] text-slate">{pricing.onboardingBody}</p>
        </div>
      </div>

      <p className="mt-6 text-center text-[13px] text-slate-muted">{pricing.feesNote}</p>
    </div>
  )
}
