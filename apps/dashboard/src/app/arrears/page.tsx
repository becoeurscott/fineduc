'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Amount,
  Badge,
  Button,
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
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'

export default function ArrearsPage() {
  const { t, intlLocale } = useApp()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [classGroupId, setClassGroupId] = useState('')
  const [sort, setSort] = useState<'amount_desc' | 'age_desc' | 'name_asc'>('amount_desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const { data: classGroups } = useQuery({ queryKey: qk.classGroups, queryFn: () => getApi().getClassGroups() })

  const query = { search: search || undefined, classGroupId: classGroupId || undefined, sort }
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.arrears(query),
    queryFn: () => getApi().listArrears(query),
  })

  // Dry-run only. Nothing is sent until the director sees the real
  // recipient count and cost — a reminder storm is a financial incident
  // (ARCHITECTURE.md §16), so the blast radius is always shown first.
  const preview = useMutation({
    mutationFn: () => getApi().previewReminder({ studentIds: [...selected], channel: 'whatsapp' }),
  })

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <PageHeader
        title={t('arrears.title')}
        description={data ? `${data.length}` : undefined}
        action={
          selected.size > 0 ? (
            <Button size="sm" loading={preview.isPending} onClick={() => preview.mutate()}>
              {t('arrears.remindSelected')} ({selected.size})
            </Button>
          ) : undefined
        }
      />

      {preview.data ? (
        <div className="mb-4 rounded-[var(--radius-card)] border border-accent-soft bg-accent-soft/40 p-4">
          <p className="text-sm font-medium text-ink">
            {preview.data.recipientCount} destinataire(s) · coût estimé{' '}
            <Amount value={preview.data.estimatedCost} locale={intlLocale} size="sm" className="font-semibold" />
          </p>
          <p className="mt-1 text-xs text-slate">
            Ignorés : {preview.data.skipped.alreadyPaid} déjà à jour, {preview.data.skipped.optedOut} désinscrits,{' '}
            {preview.data.skipped.quarantined} en quarantaine.
          </p>
          {preview.data.exceedsBalance ? (
            <p className="mt-1 text-xs font-medium text-danger">
              Crédits insuffisants — rechargez avant d’envoyer.
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            {/* Deliberately NOT wired to a send: the messaging module does
                not exist yet (ARCHITECTURE.md §15 phase 7). Better a
                disabled button than a lie. */}
            <Button size="sm" disabled title="Module de messagerie non encore implémenté (phase 7)">
              {t('common.confirm')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => preview.reset()}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
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
        <Select value={classGroupId} onChange={(e) => setClassGroupId(e.target.value)} aria-label={t('common.class')} className="sm:max-w-[11rem]">
          <option value="">{t('common.all')}</option>
          {classGroups?.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Tri"
          className="sm:max-w-[13rem]"
        >
          <option value="amount_desc">{t('arrears.sortAmount')}</option>
          <option value="age_desc">{t('arrears.sortAge')}</option>
          <option value="name_asc">{t('arrears.sortName')}</option>
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
          <EmptyState title={t('arrears.empty')} />
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th className="w-10">
                    <span className="sr-only">Sélection</span>
                  </Th>
                  <Th>{t('common.student')}</Th>
                  <Th>{t('common.class')}</Th>
                  <Th align="right">{t('arrears.daysLate')}</Th>
                  <Th align="right">{t('common.balance')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((student) => (
                  <Tr key={student.id}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={selected.has(student.id)}
                        onChange={() => toggle(student.id)}
                        aria-label={`Sélectionner ${student.firstName} ${student.lastName}`}
                        className="size-4 accent-[#1d1d1d]"
                      />
                    </Td>
                    <Td>
                      <button
                        onClick={() => router.push(`/students/${student.id}`)}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {student.firstName} {student.lastName}
                      </button>
                      <span className="ml-2 text-xs text-slate">{student.matricule}</span>
                    </Td>
                    <Td className="text-slate">{student.className}</Td>
                    <Td align="right">
                      <Badge tone={student.daysOverdue > 90 ? 'danger' : student.daysOverdue > 30 ? 'warning' : 'neutral'}>
                        {student.daysOverdue} {t('arrears.days')}
                      </Badge>
                    </Td>
                    <Td align="right">
                      <Amount value={student.balance} locale={intlLocale} size="sm" className="font-semibold text-danger" />
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
