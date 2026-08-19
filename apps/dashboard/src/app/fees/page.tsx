'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Amount,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Skeleton,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
} from '@fineduc/ui'
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'

export default function FeesPage() {
  const { t, intlLocale } = useApp()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.feeSchedules,
    queryFn: () => getApi().listFeeSchedules(),
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
      <PageHeader title={t('fees.title')} />

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-64 rounded-[var(--radius-card)]" />
          <Skeleton className="h-64 rounded-[var(--radius-card)]" />
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((schedule) => {
            const itemsTotal = schedule.items.reduce((sum, item) => sum + Number(item.amount.amountMinor), 0)
            const planTotal = schedule.instalmentPlan.templates.reduce(
              (sum, tpl) => sum + Number(tpl.amount.amountMinor),
              0,
            )
            // The invariant from ARCHITECTURE.md §8.1, surfaced rather than
            // assumed: instalments must re-sum to the schedule total.
            const reconciles = itemsTotal === planTotal && planTotal === Number(schedule.total.amountMinor)

            return (
              <Card key={schedule.id}>
                <CardHeader
                  title={schedule.name}
                  description={`${schedule.academicYearName} · ${t('fees.version')} ${schedule.version}`}
                  action={
                    <Badge tone={schedule.status === 'published' ? 'positive' : 'neutral'}>
                      {schedule.status === 'published' ? t('fees.published') : t('fees.draft')}
                    </Badge>
                  }
                />

                {schedule.status === 'published' && schedule.enrolmentCount > 0 ? (
                  <div className="mx-4 mb-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs text-slate sm:mx-5">
                    {t('fees.lockedNotice', { count: schedule.enrolmentCount })}
                  </div>
                ) : null}

                <CardBody className="pt-2">
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-xs font-medium text-slate">Postes de frais</h3>
                      <TableScroll>
                        <Table className="min-w-0">
                          <tbody>
                            {schedule.items.map((item) => (
                              <Tr key={item.id}>
                                <Td>{item.label}</Td>
                                <Td align="right">
                                  <Amount value={item.amount} locale={intlLocale} size="sm" />
                                </Td>
                              </Tr>
                            ))}
                            <tr>
                              <Td className="font-semibold">{t('common.total')}</Td>
                              <Td align="right">
                                <Amount value={schedule.total} locale={intlLocale} size="sm" className="font-semibold" />
                              </Td>
                            </tr>
                          </tbody>
                        </Table>
                      </TableScroll>
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs font-medium text-slate">
                        {t('fees.instalmentPlan')} — {schedule.instalmentPlan.name}
                      </h3>
                      <TableScroll>
                        <Table className="min-w-0">
                          <thead>
                            <tr>
                              <Th>Tranche</Th>
                              <Th>{t('common.date')}</Th>
                              <Th align="right">{t('common.amount')}</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {schedule.instalmentPlan.templates.map((tpl) => (
                              <Tr key={tpl.id}>
                                <Td>{tpl.label}</Td>
                                <Td className="text-slate">{tpl.dueOn}</Td>
                                <Td align="right">
                                  <Amount value={tpl.amount} locale={intlLocale} size="sm" />
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </TableScroll>
                      <p className={reconciles ? 'mt-2 text-xs text-positive' : 'mt-2 text-xs font-medium text-danger'}>
                        {reconciles
                          ? '✓ Les tranches totalisent exactement la grille.'
                          : '✗ Les tranches ne totalisent pas la grille — incohérence à corriger.'}
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
