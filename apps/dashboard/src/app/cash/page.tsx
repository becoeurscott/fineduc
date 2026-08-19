'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Amount,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
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

const MOVEMENT_LABEL: Record<string, string> = {
  payment: 'Encaissement',
  float_in: 'Fonds de caisse',
  float_out: 'Retrait',
  deposit_to_bank: 'Dépôt en banque',
  correction: 'Correction',
}

export default function CashPage() {
  const { t, intlLocale } = useApp()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.cashSessions,
    queryFn: () => getApi().getOpenCashSessions(),
  })

  if (isError) {
    return (
      <Card>
        <ErrorState title={t('common.error')} onRetry={() => void refetch()} />
      </Card>
    )
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title={t('cash.title')} />
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      </>
    )
  }

  const session = data?.[0]

  return (
    <>
      <PageHeader
        title={t('cash.title')}
        action={session ? undefined : <Button size="sm">{t('cash.openSession')}</Button>}
      />

      {!session ? (
        <Card>
          <EmptyState title={t('cash.noOpenSession')} action={<Button size="sm">{t('cash.openSession')}</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title={session.deskName}
                description={`${t('cash.cashier')} : ${session.cashierName} · ${t('cash.openedAt')} ${new Date(
                  session.openedAt,
                ).toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })}`}
                action={<Badge tone="warning">Ouverte</Badge>}
              />
              <CardBody className="pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate">{t('cash.openingFloat')}</p>
                    <Amount value={session.openingFloat} locale={intlLocale} size="md" className="mt-0.5 block font-medium" />
                  </div>
                  <div>
                    <p className="text-xs text-slate">{t('cash.expected')}</p>
                    <Amount value={session.expectedClose} locale={intlLocale} size="lg" className="mt-0.5 block" />
                  </div>
                </div>
              </CardBody>

              <div className="border-t border-line">
                <CardHeader title={t('cash.movements')} />
                <TableScroll className="px-1 pb-2">
                  <Table className="min-w-[30rem]">
                    <thead>
                      <tr>
                        <Th>Heure</Th>
                        <Th>Type</Th>
                        <Th>Référence</Th>
                        <Th align="right">{t('common.amount')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {session.movements.map((movement) => (
                        <Tr key={movement.id}>
                          <Td className="whitespace-nowrap text-slate">
                            {new Date(movement.createdAt).toLocaleTimeString(intlLocale, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Td>
                          <Td>{MOVEMENT_LABEL[movement.type] ?? movement.type}</Td>
                          <Td className="text-slate">{movement.reference ?? movement.note ?? '—'}</Td>
                          <Td align="right">
                            <Amount value={movement.amount} locale={intlLocale} size="sm" signed />
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </TableScroll>
              </div>
            </Card>
          </div>

          <CloseSessionCard expected={session.expectedClose} />
        </div>
      )}
    </>
  )
}

/**
 * The close-with-count flow — the answer to "espèces mal tracées".
 *
 * The variance is computed and shown BEFORE the cashier can confirm, and a
 * reason becomes mandatory the moment it is non-zero (ARCHITECTURE.md
 * §8.4). The same rule is enforced in the contract
 * (`CloseCashSessionInputSchema`) and will be enforced again server-side —
 * this UI check is the courtesy, not the control.
 */
function CloseSessionCard({ expected }: { expected: { amountMinor: string; currency: string } }) {
  const { t, intlLocale } = useApp()
  const [declared, setDeclared] = useState('')
  const [reason, setReason] = useState('')

  const expectedMinor = BigInt(expected.amountMinor)
  // XAF has zero decimals — parse as a whole-franc integer, never a float.
  const declaredClean = declared.replace(/[^\d-]/g, '')
  const declaredMinor = declaredClean === '' ? null : BigInt(declaredClean)
  const variance = declaredMinor === null ? null : declaredMinor - expectedMinor
  const hasVariance = variance !== null && variance !== 0n
  const reasonMissing = hasVariance && reason.trim().length === 0
  const canClose = declaredMinor !== null && !reasonMissing

  return (
    <Card>
      <CardHeader title={t('cash.closeSession')} />
      <CardBody className="space-y-3 pt-2">
        <div>
          <p className="text-xs text-slate">{t('cash.expected')}</p>
          <Amount value={expected} locale={intlLocale} size="md" className="mt-0.5 block font-medium" />
        </div>

        <Field label={t('cash.declared')}>
          <Input
            inputMode="numeric"
            value={declared}
            onChange={(e) => setDeclared(e.target.value)}
            placeholder="0"
            aria-describedby="variance-readout"
          />
        </Field>

        <div id="variance-readout" aria-live="polite">
          {variance === null ? null : (
            <div
              className={
                hasVariance
                  ? 'rounded-[var(--radius-control)] border border-danger-soft bg-danger-soft/15 px-3 py-2'
                  : 'rounded-[var(--radius-control)] border border-positive-soft bg-positive-soft/40 px-3 py-2'
              }
            >
              <p className="text-xs text-slate">{t('cash.variance')}</p>
              <Amount
                value={{ amountMinor: variance.toString(), currency: expected.currency }}
                locale={intlLocale}
                size="md"
                signed
                className="font-semibold"
              />
            </div>
          )}
        </div>

        {hasVariance ? (
          <Field label={t('cash.varianceReason')} error={reasonMissing ? t('cash.varianceRequired') : undefined}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Expliquez l’écart" />
          </Field>
        ) : null}

        {/*
          No optimistic UI on a money operation (ARCHITECTURE.md §13) — and
          the cashbox module does not exist yet (phase 5), so this stays
          disabled rather than pretending to close a real desk.
        */}
        <Button
          className="w-full"
          disabled={!canClose}
          title="Module caisse non encore implémenté (phase 5)"
        >
          {t('cash.closeSession')}
        </Button>
      </CardBody>
    </Card>
  )
}
