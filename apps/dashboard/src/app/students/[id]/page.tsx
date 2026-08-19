'use client'

import Link from 'next/link'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Amount,
  Badge,
  Button,
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
import type { InstalmentStatus } from '@fineduc/contracts'
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'

const INSTALMENT_TONE: Record<InstalmentStatus, 'positive' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'positive',
  partial: 'warning',
  overdue: 'danger',
  pending: 'neutral',
  waived: 'neutral',
  cancelled: 'neutral',
}

const INSTALMENT_LABEL: Record<InstalmentStatus, string> = {
  paid: 'Payée',
  partial: 'Partielle',
  overdue: 'En retard',
  pending: 'À venir',
  waived: 'Exonérée',
  cancelled: 'Annulée',
}

export default function StudentFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { t, intlLocale } = useApp()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.student(id),
    queryFn: () => getApi().getStudent(id),
  })

  if (isError) {
    return (
      <Card>
        <ErrorState title={t('common.error')} onRetry={() => void refetch()} />
      </Card>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 rounded-[var(--radius-card)]" />
        <Skeleton className="h-72 rounded-[var(--radius-card)]" />
      </div>
    )
  }

  const owes = Number(data.balance.amountMinor) > 0

  return (
    <>
      <div className="mb-2">
        <Link href="/students" className="text-xs text-accent underline-offset-2 hover:underline">
          ← {t('students.title')}
        </Link>
      </div>

      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        description={`${data.matricule} · ${data.className} · ${data.academicYearName}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm">
              {t('students.sendReminder')}
            </Button>
            <Button size="sm">{t('students.recordPayment')}</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium text-slate">{t('students.totalDue')}</p>
          <Amount value={data.totalDue} locale={intlLocale} size="lg" className="mt-1 block" />
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-slate">{t('students.totalPaid')}</p>
          <Amount value={data.totalPaid} locale={intlLocale} size="lg" className="mt-1 block text-positive" />
        </div>
        <div className="card col-span-2 p-4">
          <p className="text-xs font-medium text-slate">{t('common.balance')}</p>
          <Amount
            value={data.balance}
            locale={intlLocale}
            size="xl"
            className={owes ? 'mt-1 block text-danger' : 'mt-1 block text-positive'}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('students.instalments')} />
            <TableScroll className="px-1 pb-2">
              <Table className="min-w-[30rem]">
                <thead>
                  <tr>
                    <Th>Tranche</Th>
                    <Th>{t('common.date')}</Th>
                    <Th align="right">{t('common.amount')}</Th>
                    <Th align="right">Reste</Th>
                    <Th align="right">{t('common.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.instalments.map((inst) => (
                    <Tr key={inst.id}>
                      <Td className="font-medium">{inst.label}</Td>
                      <Td className="text-slate">{inst.dueOn}</Td>
                      <Td align="right">
                        <Amount value={inst.amount} locale={intlLocale} size="sm" />
                      </Td>
                      <Td align="right">
                        <Amount
                          value={inst.remaining}
                          locale={intlLocale}
                          size="sm"
                          className={Number(inst.remaining.amountMinor) > 0 ? 'font-medium text-danger' : 'text-slate'}
                        />
                      </Td>
                      <Td align="right">
                        <Badge tone={INSTALMENT_TONE[inst.status]}>{INSTALMENT_LABEL[inst.status]}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <Card>
            <CardHeader title={t('students.ledger')} description="Écritures — jamais modifiées, seulement ajoutées" />
            <TableScroll className="px-1 pb-2">
              <Table className="min-w-[30rem]">
                <thead>
                  <tr>
                    <Th>{t('common.date')}</Th>
                    <Th>Libellé</Th>
                    <Th align="right">{t('common.amount')}</Th>
                    <Th align="right">Solde</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((entry) => (
                    <Tr key={entry.id}>
                      <Td className="text-slate whitespace-nowrap">{entry.occurredOn}</Td>
                      <Td>{entry.memo ?? entry.entryType}</Td>
                      <Td align="right">
                        <Amount value={entry.amount} locale={intlLocale} size="sm" signed />
                      </Td>
                      <Td align="right" className="font-medium">
                        <Amount value={entry.balanceAfter} locale={intlLocale} size="sm" />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('students.guardians')} />
            <CardBody className="space-y-3 pt-2">
              {data.guardians.map((guardian) => (
                <div key={guardian.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {guardian.firstName} {guardian.lastName}
                    </p>
                    <p className="truncate text-xs text-slate">
                      {guardian.relationship} · {guardian.phoneE164}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {guardian.paysFees ? <Badge tone="accent">Payeur</Badge> : null}
                    {guardian.quarantined ? <Badge tone="danger">Numéro en quarantaine</Badge> : null}
                    {guardian.optedOut ? <Badge tone="warning">Désinscrit</Badge> : null}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>

          {data.siblings.length > 0 ? (
            <Card>
              <CardHeader title={t('students.siblings')} />
              <CardBody className="space-y-2 pt-2">
                {data.siblings.map((sibling) => (
                  <Link
                    key={sibling.id}
                    href={`/students/${sibling.id}`}
                    className="flex items-center justify-between gap-2 text-sm hover:text-accent"
                  >
                    <span className="min-w-0 truncate">
                      {sibling.firstName} {sibling.lastName}
                      <span className="ml-1.5 text-xs text-slate">{sibling.matricule}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate">{sibling.className}</span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t('students.messages')} />
            <CardBody className="space-y-3 pt-2">
              {data.messages.length === 0 ? (
                <p className="text-sm text-slate">—</p>
              ) : (
                data.messages.map((message) => (
                  <div key={message.id} className="border-l-2 border-line pl-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={message.status === 'failed' ? 'danger' : 'neutral'}>{message.channel}</Badge>
                      <span className="text-xs text-slate">
                        {message.sentAt
                          ? new Date(message.sentAt).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short' })
                          : '—'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate">{message.bodyRendered}</p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
