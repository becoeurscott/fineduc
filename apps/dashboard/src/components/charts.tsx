'use client'

import { useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AGE_BUCKET_COLORS, Amount, CHART_CHROME, PAYMENT_METHOD_COLORS, Table, TableScroll, Td, Th, Tr } from '@fineduc/ui'
import { Money, format } from '@fineduc/money'
import { useApp } from '@/lib/app-context'
import { METHOD_LABEL } from '@/lib/i18n'

type MoneyWire = { amountMinor: string; currency: string }

const compact = (wire: MoneyWire, locale: string) => {
  const value = Number(wire.amountMinor)
  // Axis ticks only — never a figure the reader acts on. Full precision
  // always appears in the tooltip, the legend, and the data table.
  // No space before the unit: Recharts measures the tick as one string, and
  // a space lets it wrap to two lines inside a narrow axis gutter.
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000).toLocaleString(locale)}k`
  return value.toLocaleString(locale)
}

/**
 * Every chart in this dashboard ships with a data-table toggle.
 *
 * That is not decoration: the colour validator flagged the categorical
 * greens/ambers as below 3:1 against the light surface, a WARN it
 * explicitly calls non-dismissable — relief must be provided as visible
 * labels or a table view. Both are here. Do not remove this toggle.
 */
export function ChartFrame({
  title,
  description,
  children,
  table,
}: {
  title: string
  description?: string
  children: ReactNode
  table: ReactNode
}) {
  const { t } = useApp()
  const [showTable, setShowTable] = useState(false)

  return (
    <section className="card flex flex-col">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-slate">{description}</p> : null}
        </div>
        <button
          onClick={() => setShowTable((value) => !value)}
          className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-slate transition-colors hover:text-ink"
          aria-expanded={showTable}
        >
          {showTable ? t('common.hideData') : t('common.viewData')}
        </button>
      </div>
      <div className="p-4 pt-3 sm:p-5 sm:pt-3">{showTable ? table : children}</div>
    </section>
  )
}

/** Shared tooltip — full-precision money, never the compacted axis form. */
function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; payload: Record<string, unknown> }[]; label?: string }) {
  const { intlLocale } = useApp()
  if (!active || !payload?.length) return null
  const first = payload[0]
  if (!first) return null
  const currency = (first.payload.currency as string) ?? 'XAF'
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-[var(--shadow-raised)]">
      {label ? <p className="mb-0.5 text-xs text-slate">{label}</p> : null}
      <p className="text-sm font-semibold text-ink">
        {format(Money.of(String(Math.round(first.value)), currency as 'XAF'), { locale: intlLocale })}
      </p>
    </div>
  )
}

/* ------------------------------------------------- collections over time */

export function CollectionTrendChart({ points }: { points: { on: string; collected: MoneyWire }[] }) {
  const { intlLocale, t } = useApp()
  const data = points.map((p) => ({
    on: p.on,
    label: new Date(`${p.on}T00:00:00Z`).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short' }),
    value: Number(p.collected.amountMinor),
    currency: p.collected.currency,
  }))

  return (
    <ChartFrame
      title={t('overview.collectionTrend')}
      table={
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th align="right">{t('common.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <Tr key={p.on}>
                  <Td>{p.on}</Td>
                  <Td align="right">
                    <Amount value={p.collected} locale={intlLocale} size="sm" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      }
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="collectFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: CHART_CHROME.axisLabel }}
              tickLine={false}
              axisLine={{ stroke: CHART_CHROME.grid }}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: CHART_CHROME.axisLabel }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value: number) => compact({ amountMinor: String(value), currency: 'XAF' }, intlLocale)}
            />
            <Tooltip content={<MoneyTooltip />} cursor={{ stroke: CHART_CHROME.axis, strokeDasharray: '3 3' }} />
            {/* 2px line, per the mark spec — thin marks, recessive chrome. */}
            <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fill="url(#collectFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  )
}

/* --------------------------------------------------------- arrears ageing */

export function ArrearsAgeingChart({
  buckets,
}: {
  buckets: { bucket: '0-30' | '31-60' | '61-90' | '90+'; outstanding: MoneyWire; studentCount: number }[]
}) {
  const { intlLocale, t } = useApp()
  const data = buckets.map((b) => ({
    bucket: b.bucket,
    value: Number(b.outstanding.amountMinor),
    currency: b.outstanding.currency,
    students: b.studentCount,
  }))

  return (
    <ChartFrame
      title={t('overview.arrearsAgeing')}
      description={`${t('arrears.daysLate')} — jours`}
      table={
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>{t('arrears.daysLate')}</Th>
                <Th align="right">{t('common.student')}</Th>
                <Th align="right">{t('common.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <Tr key={b.bucket}>
                  <Td>{b.bucket}</Td>
                  <Td align="right">{b.studentCount}</Td>
                  <Td align="right">
                    <Amount value={b.outstanding} locale={intlLocale} size="sm" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      }
    >
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11, fill: CHART_CHROME.axisLabel }}
              tickLine={false}
              axisLine={{ stroke: CHART_CHROME.grid }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: CHART_CHROME.axisLabel }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value: number) => compact({ amountMinor: String(value), currency: 'XAF' }, intlLocale)}
            />
            <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'rgba(29,29,29,0.04)' }} />
            {/* 4px rounded data-end anchored to the baseline. */}
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {data.map((entry) => (
                <Cell key={entry.bucket} fill={AGE_BUCKET_COLORS[entry.bucket]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Sequential ramp — a legend of ordered swatches, direct-labelled. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {buckets.map((b) => (
          <li key={b.bucket} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: AGE_BUCKET_COLORS[b.bucket] }}
            />
            <span className="text-slate">{b.bucket} j</span>
            <Amount value={b.outstanding} locale={intlLocale} size="sm" className="font-medium text-ink" />
          </li>
        ))}
      </ul>
    </ChartFrame>
  )
}

/* ------------------------------------------------------ payment method mix */

export function MethodMixChart({
  mix,
}: {
  mix: { method: string; amount: MoneyWire; shareBp: number }[]
}) {
  const { intlLocale, locale, t } = useApp()

  // Fold the long tail into "other" — six chromatic hues could not clear
  // the all-pairs CVD check, so the palette is four series by design
  // (packages/ui/src/tokens/charts.ts).
  const folded = new Map<string, { amount: number; shareBp: number; currency: string }>()
  for (const row of mix) {
    const key = ['mobile_money', 'cash', 'bank_transfer'].includes(row.method) ? row.method : 'other'
    const prev = folded.get(key) ?? { amount: 0, shareBp: 0, currency: row.amount.currency }
    folded.set(key, {
      amount: prev.amount + Number(row.amount.amountMinor),
      shareBp: prev.shareBp + row.shareBp,
      currency: row.amount.currency,
    })
  }

  const data = [...folded.entries()].map(([method, v]) => ({
    method,
    label: METHOD_LABEL[locale][method] ?? method,
    value: v.amount,
    currency: v.currency,
    shareBp: v.shareBp,
    color: PAYMENT_METHOD_COLORS[method as keyof typeof PAYMENT_METHOD_COLORS] ?? PAYMENT_METHOD_COLORS.other,
  }))

  return (
    <ChartFrame
      title={t('overview.methodMix')}
      table={
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>{t('common.method')}</Th>
                <Th align="right">%</Th>
                <Th align="right">{t('common.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <Tr key={row.method}>
                  <Td>{row.label}</Td>
                  <Td align="right">{(row.shareBp / 100).toFixed(1).replace('.', ',')} %</Td>
                  <Td align="right">
                    <Amount value={{ amountMinor: String(row.value), currency: row.currency }} locale={intlLocale} size="sm" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      }
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={44}
                outerRadius={72}
                paddingAngle={2}
                stroke="#ffffff"
                strokeWidth={2}
              >
                {data.map((entry) => (
                  <Cell key={entry.method} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<MoneyTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {/* Legend carries the value — identity is never colour alone. */}
        <ul className="w-full space-y-1.5">
          {data.map((row) => (
            <li key={row.method} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                <span className="truncate text-slate">{row.label}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-xs text-slate-muted">{(row.shareBp / 100).toFixed(0)} %</span>
                <Amount
                  value={{ amountMinor: String(row.value), currency: row.currency }}
                  locale={intlLocale}
                  size="sm"
                  className="font-medium"
                />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  )
}
