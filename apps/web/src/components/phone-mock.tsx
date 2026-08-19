import { AGE_BUCKET_COLORS, PAYMENT_METHOD_COLORS } from '@fineduc/ui'

/**
 * The dashboard showcase — "the money shot" (PRD §8).
 *
 * A hand-built, static replica of the real director screen rather than a
 * screenshot: it stays crisp at any density, weighs a fraction of a PNG on
 * a 3G connection, and the numbers are real text (so they translate, scale
 * with the user's font size, and are readable by a screen reader).
 *
 * Colours come from the same validated tokens the product uses, so the
 * marketing site and the dashboard cannot drift apart.
 */
export function PhoneMock({
  stats,
  locale,
}: {
  stats: readonly { label: string; value: string }[]
  locale: 'fr' | 'en'
}) {
  const ageing = [
    { bucket: '0-30' as const, height: 62 },
    { bucket: '31-60' as const, height: 26 },
    { bucket: '61-90' as const, height: 24 },
    { bucket: '90+' as const, height: 54 },
  ]
  const methods = [
    { key: 'mobile_money' as const, label: 'Mobile money', share: 52 },
    { key: 'cash' as const, label: locale === 'fr' ? 'Espèces' : 'Cash', share: 31 },
    { key: 'bank_transfer' as const, label: locale === 'fr' ? 'Virement' : 'Transfer', share: 14 },
  ]

  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="rounded-[2.25rem] border border-line bg-ink p-2.5 shadow-[var(--shadow-raised)]">
        <div className="overflow-hidden rounded-[1.75rem] bg-canvas">
          {/* status bar */}
          <div className="flex items-center justify-between bg-surface px-4 pt-3 pb-2">
            <span className="text-[10px] font-medium text-ink">09:41</span>
            <span className="flex gap-1" aria-hidden="true">
              <span className="block h-1 w-1 rounded-full bg-slate-muted" />
              <span className="block h-1 w-1 rounded-full bg-slate-muted" />
              <span className="block h-1 w-1 rounded-full bg-slate-muted" />
            </span>
          </div>

          <div className="border-b border-line bg-surface px-4 pb-2.5">
            <p className="text-[11px] font-semibold text-ink">École Bilingue Excellence</p>
            <p className="text-[9px] text-slate">{locale === 'fr' ? 'Directeur' : 'Director'} · 2026-2027</p>
          </div>

          <div className="space-y-2.5 p-3">
            {/* headline figures */}
            <div className="grid grid-cols-2 gap-2">
              {stats.slice(0, 2).map((stat) => (
                <div key={stat.label} className="rounded-xl border border-line bg-surface p-2.5">
                  <p className="text-[8px] leading-tight text-slate">{stat.label}</p>
                  <p className="mt-1 text-[13px] leading-tight font-semibold tracking-tight text-ink">{stat.value}</p>
                </div>
              ))}
            </div>

            {stats[2] ? (
              <div className="rounded-xl border border-line bg-surface p-2.5">
                <p className="text-[8px] text-slate">{stats[2].label}</p>
                <p className="mt-1 text-[15px] font-semibold tracking-tight text-danger">{stats[2].value}</p>
              </div>
            ) : null}

            {/* collection trend — a real path, not a placeholder rectangle */}
            <div className="rounded-xl border border-line bg-surface p-2.5">
              <p className="mb-1.5 text-[8px] font-medium text-slate">
                {locale === 'fr' ? 'Encaissements — 30 jours' : 'Collections — 30 days'}
              </p>
              <svg viewBox="0 0 240 56" className="h-12 w-full" role="img" aria-label="Collections trend">
                <defs>
                  <linearGradient id="mockFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 42 L20 36 L40 44 L60 30 L80 34 L100 18 L120 26 L140 8 L160 22 L180 30 L200 16 L220 24 L240 12 L240 56 L0 56 Z"
                  fill="url(#mockFill)"
                />
                <path
                  d="M0 42 L20 36 L40 44 L60 30 L80 34 L100 18 L120 26 L140 8 L160 22 L180 30 L200 16 L220 24 L240 12"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* method mix */}
              <div className="rounded-xl border border-line bg-surface p-2.5">
                <p className="mb-1.5 text-[8px] font-medium text-slate">
                  {locale === 'fr' ? 'Moyens de paiement' : 'Payment methods'}
                </p>
                <ul className="space-y-1">
                  {methods.map((method) => (
                    <li key={method.key} className="flex items-center gap-1.5">
                      <span
                        className="size-1.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: PAYMENT_METHOD_COLORS[method.key] }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate text-[7px] text-slate">{method.label}</span>
                      <span className="text-[7px] font-medium text-ink">{method.share}%</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* arrears ageing — the validated sequential ramp */}
              <div className="rounded-xl border border-line bg-surface p-2.5">
                <p className="mb-1.5 text-[8px] font-medium text-slate">
                  {locale === 'fr' ? 'Ancienneté' : 'Arrears ageing'}
                </p>
                <div className="flex h-[52px] items-end justify-between gap-1">
                  {ageing.map((bar) => (
                    <div key={bar.bucket} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-[3px]"
                        style={{ height: `${bar.height}%`, backgroundColor: AGE_BUCKET_COLORS[bar.bucket] }}
                      />
                      <span className="text-[6px] text-slate-muted">{bar.bucket}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
