'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import {
  Amount,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  RecoveryMeter,
  Skeleton,
  StatTile,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
} from '@fineduc/ui'
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'

/**
 * Recharts is ~110 kB — on its own it was more than doubling this route's
 * First Load JS (256 kB vs ~146 kB elsewhere). PRD §5 commits to "low-end
 * Android, small data budget", so the charts are code-split and stream in
 * after the headline figures, which are the numbers the director actually
 * opens this page for. `ssr: false` because Recharts measures the DOM to
 * size itself and has nothing useful to render on the server.
 */
const chartSkeleton = () => <Skeleton className="h-72 rounded-[var(--radius-card)]" />

const CollectionTrendChart = dynamic(
  () => import('@/components/charts').then((m) => m.CollectionTrendChart),
  { ssr: false, loading: chartSkeleton },
)
const MethodMixChart = dynamic(() => import('@/components/charts').then((m) => m.MethodMixChart), {
  ssr: false,
  loading: chartSkeleton,
})
const ArrearsAgeingChart = dynamic(() => import('@/components/charts').then((m) => m.ArrearsAgeingChart), {
  ssr: false,
  loading: chartSkeleton,
})

export default function OverviewPage() {
  const { t, intlLocale } = useApp()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.overview,
    queryFn: () => getApi().getOverview(),
    // Matches ARCHITECTURE.md §13: cached 30s, auto-refresh 60s.
    refetchInterval: 60_000,
  })

  if (isError) {
    return (
      <Card>
        <ErrorState title={t('common.error')} onRetry={() => void refetch()} />
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title={t('overview.title')}
        description={
          data ? `${data.tenantName} · ${data.academicYearName}` : undefined
        }
      />

      {data?.alerts.length ? (
        <ul className="mb-4 space-y-2">
          {data.alerts.map((alert) => (
            <li
              key={alert.code}
              role={alert.severity === 'critical' ? 'alert' : undefined}
              className={
                alert.severity === 'critical'
                  ? 'rounded-[var(--radius-control)] border border-danger-soft bg-danger-soft/15 px-3 py-2 text-sm text-danger'
                  : alert.severity === 'warning'
                    ? 'rounded-[var(--radius-control)] border border-warning-soft bg-warning-soft/20 px-3 py-2 text-sm text-ink'
                    : 'rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-slate'
              }
            >
              {/* Status is never colour alone — each carries a written label. */}
              <span className="mr-1.5 font-medium">
                {alert.severity === 'critical' ? '⚠' : alert.severity === 'warning' ? '!' : 'i'}
              </span>
              {alert.message}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Headline figures. One number each — a stat tile, not a one-bar chart. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label={t('overview.collectedToday')}
          value={data?.collectedToday ?? { amountMinor: '0', currency: 'XAF' }}
          loading={isLoading}
        />
        <StatTile
          label={t('overview.collectedWeek')}
          value={data?.collectedThisWeek ?? { amountMinor: '0', currency: 'XAF' }}
          loading={isLoading}
        />
        {isLoading || !data ? (
          <div className="card p-4 sm:p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-9 w-28" />
          </div>
        ) : (
          <RecoveryMeter rateBp={data.recoveryRateBp} label={t('overview.recoveryRate')} target={8_500} />
        )}
        <StatTile
          label={t('overview.outstanding')}
          value={data?.totalOutstanding ?? { amountMinor: '0', currency: 'XAF' }}
          tone="danger"
          sublabel={
            data ? (
              <Link href="/arrears" className="text-accent underline-offset-2 hover:underline">
                {data.studentsInArrears} {t('overview.studentsInArrears')}
              </Link>
            ) : undefined
          }
          loading={isLoading}
        />
      </div>

      {isLoading || !data ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-[var(--radius-card)]" />
          <Skeleton className="h-72 rounded-[var(--radius-card)]" />
        </div>
      ) : (
        <>
          <div className="mt-4">
            <CollectionTrendChart points={data.collectionTrend} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <MethodMixChart mix={data.methodMix} />
            <ArrearsAgeingChart buckets={data.arrearsAgeing} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={t('overview.arrearsByClass')}
                action={
                  <Link href="/arrears" className="text-xs text-accent underline-offset-2 hover:underline">
                    {t('nav.arrears')} →
                  </Link>
                }
              />
              <TableScroll className="px-1 pb-2">
                <Table className="min-w-[26rem]">
                  <thead>
                    <tr>
                      <Th>{t('common.class')}</Th>
                      <Th align="right">{t('overview.studentsInArrears')}</Th>
                      <Th align="right">{t('common.amount')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.arrearsByClass.map((row) => (
                      <Tr key={row.classGroupId}>
                        <Td>{row.className}</Td>
                        <Td align="right" className="text-slate">
                          {row.studentsInArrears} / {row.totalStudents}
                        </Td>
                        <Td align="right">
                          <Amount value={row.outstanding} locale={intlLocale} size="sm" className="font-medium" />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader
                  title={t('overview.cashStatus')}
                  action={
                    <Link href="/cash" className="text-xs text-accent underline-offset-2 hover:underline">
                      {t('nav.cash')} →
                    </Link>
                  }
                />
                <CardBody className="pt-2">
                  {data.openCashSessions.length === 0 ? (
                    <p className="text-sm text-slate">{t('overview.noCashOpen')}</p>
                  ) : (
                    <ul className="space-y-3">
                      {data.openCashSessions.map((session) => (
                        <li key={session.sessionId} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{session.deskName}</p>
                            <p className="truncate text-xs text-slate">
                              {session.cashierName} ·{' '}
                              {new Date(session.openedAt).toLocaleTimeString(intlLocale, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <Amount value={session.expectedInDrawer} locale={intlLocale} size="sm" className="font-semibold" />
                            <div className="mt-0.5">
                              <Badge tone="warning">{t('cash.expected')}</Badge>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title={t('overview.reminderPerf')} />
                <CardBody className="pt-2">
                  <div className="flex items-baseline gap-2">
                    <Amount value={data.reminders.collectedWithin72h} locale={intlLocale} size="lg" className="text-positive" />
                  </div>
                  <p className="mt-0.5 text-xs text-slate">{t('overview.collectedAfterReminder')}</p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                    <div>
                      <dt className="text-slate">Envoyés</dt>
                      <dd className="mt-0.5 font-semibold text-ink">{data.reminders.sent}</dd>
                    </div>
                    <div>
                      <dt className="text-slate">Délivrés</dt>
                      <dd className="mt-0.5 font-semibold text-ink">
                        {Math.round((data.reminders.delivered / data.reminders.sent) * 100)} %
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate">{t('overview.messagingCost')}</dt>
                      <dd className="mt-0.5 font-semibold text-ink">
                        <Amount value={data.reminders.messagingCost} locale={intlLocale} size="sm" />
                      </dd>
                    </div>
                  </dl>
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  )
}
