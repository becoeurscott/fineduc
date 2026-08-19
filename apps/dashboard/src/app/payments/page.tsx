'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Amount,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
} from '@fineduc/ui'
import type { PaymentStatus } from '@fineduc/contracts'
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { METHOD_LABEL } from '@/lib/i18n'
import { PageHeader } from '@/components/shell'

const STATUS_TONE: Record<PaymentStatus, 'positive' | 'warning' | 'danger' | 'neutral'> = {
  succeeded: 'positive',
  pending: 'warning',
  processing: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'danger',
  refunded: 'neutral',
  partially_refunded: 'neutral',
}

export default function PaymentsPage() {
  const { t, intlLocale, locale } = useApp()
  const [search, setSearch] = useState('')
  const [unreconciledOnly, setUnreconciledOnly] = useState(false)

  const query = { search: search || undefined, unreconciledOnly: unreconciledOnly || undefined }
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.payments(query),
    queryFn: () => getApi().listPayments(query),
  })

  const stuck = data?.filter((p) => p.reconciledAt === null).length ?? 0

  return (
    <>
      <PageHeader title={t('payments.title')} description={data ? `${data.length}` : undefined} />

      {/* A payment stuck in pending must be obvious and actionable
          (ARCHITECTURE.md §13) — never quietly buried in the list. */}
      {stuck > 0 && !unreconciledOnly ? (
        <button
          onClick={() => setUnreconciledOnly(true)}
          className="mb-4 block w-full rounded-[var(--radius-control)] border border-warning-soft bg-warning-soft/20 px-3 py-2 text-left text-sm text-ink"
        >
          <span className="font-medium">! {stuck} paiement(s) non rapproché(s).</span>{' '}
          <span className="text-slate underline underline-offset-2">Afficher uniquement ceux-ci</span>
        </button>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('students.searchPlaceholder')}
          aria-label={t('common.search')}
          className="sm:max-w-sm"
        />
        <Select
          value={unreconciledOnly ? 'yes' : ''}
          onChange={(e) => setUnreconciledOnly(e.target.value === 'yes')}
          aria-label={t('payments.unreconciled')}
          className="sm:max-w-[16rem]"
        >
          <option value="">{t('common.all')}</option>
          <option value="yes">{t('payments.unreconciled')}</option>
        </Select>
      </div>

      <Card>
        {isError ? (
          <ErrorState title={t('common.error')} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : !data?.length ? (
          <EmptyState title={t('common.noResults')} />
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('common.student')}</Th>
                  <Th>{t('common.method')}</Th>
                  <Th align="right">{t('common.amount')}</Th>
                  <Th align="right">{t('common.status')}</Th>
                  <Th align="right">{t('payments.receipt')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((payment) => (
                  <Tr key={payment.id}>
                    <Td className="whitespace-nowrap text-slate">
                      {payment.receivedAt
                        ? new Date(payment.receivedAt).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short' })
                        : '—'}
                    </Td>
                    <Td>
                      <span className="font-medium">{payment.studentName}</span>
                      <span className="ml-2 text-xs text-slate">{payment.matricule}</span>
                    </Td>
                    <Td className="text-slate">{METHOD_LABEL[locale][payment.method] ?? payment.method}</Td>
                    <Td align="right">
                      <Amount value={payment.amount} locale={intlLocale} size="sm" className="font-medium" />
                    </Td>
                    <Td align="right">
                      <Badge tone={STATUS_TONE[payment.status]}>
                        {payment.status === 'succeeded' ? t('payments.reconciled') : t('payments.pending')}
                      </Badge>
                    </Td>
                    <Td align="right" className="text-xs text-slate">
                      {payment.receiptNumber ?? '—'}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </>
  )
}
