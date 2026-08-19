import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Amount } from './amount'
import { Skeleton } from './primitives'

/**
 * A single headline figure. Per the dataviz form heuristic, when the data's
 * job is "one number the reader must not miss", the right form is a stat
 * tile — NOT a chart with one bar.
 */
export function StatTile({
  label,
  value,
  sublabel,
  tone = 'neutral',
  loading = false,
}: {
  label: string
  value: { amountMinor: string; currency: string } | string
  sublabel?: ReactNode
  tone?: 'neutral' | 'positive' | 'warning' | 'danger'
  loading?: boolean
}) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-xs font-medium text-slate">{label}</p>
      <div className="mt-1.5">
        {loading ? (
          <Skeleton className="h-9 w-32" />
        ) : typeof value === 'string' ? (
          <span
            className={clsx(
              'text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl',
              tone === 'positive' && 'text-positive',
              tone === 'warning' && 'text-warning',
              tone === 'danger' && 'text-danger',
            )}
          >
            {value}
          </span>
        ) : (
          <Amount value={value} size="xl" />
        )}
      </div>
      {sublabel ? <div className="mt-1.5 text-xs text-slate">{sublabel}</div> : null}
    </div>
  )
}

/**
 * Recovery-rate meter. Takes basis points (integer) — never a float
 * percentage, so the displayed figure and the stored figure can't drift.
 */
export function RecoveryMeter({ rateBp, label, target }: { rateBp: number; label: string; target?: number }) {
  const pct = rateBp / 100
  const tone = rateBp >= 8_500 ? 'positive' : rateBp >= 7_000 ? 'warning' : 'danger'
  const barColor =
    tone === 'positive' ? 'bg-positive' : tone === 'warning' ? 'bg-warning' : 'bg-danger'

  return (
    <div className="card p-4 sm:p-5">
      <p className="text-xs font-medium text-slate">{label}</p>
      <p
        className={clsx(
          'mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl',
          tone === 'positive' && 'text-positive',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )}
      >
        {pct.toFixed(1).replace('.', ',')} %
      </p>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {target !== undefined ? (
        <p className="mt-1.5 text-xs text-slate">Objectif {(target / 100).toFixed(0)} %</p>
      ) : null}
    </div>
  )
}
