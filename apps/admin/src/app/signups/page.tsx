'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Card,
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
import type { SignupRequestListItem, SignupRequestStatus } from '@fineduc/contracts'

const STATUS_TONE: Record<SignupRequestStatus, 'neutral' | 'warning' | 'accent' | 'positive' | 'danger'> = {
  pending: 'warning',
  approved: 'accent',
  rejected: 'danger',
  setup_complete: 'positive',
  expired: 'neutral',
}

export default function SignupsPage() {
  const { t, intlLocale } = useApp()
  const queryClient = useQueryClient()
  const signups = useQuery({
    queryKey: qk.signupRequests,
    queryFn: () => getApi().listSignupRequests(),
  })

  const [acting, setActing] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function statusLabel(status: SignupRequestStatus): string {
    const map: Record<SignupRequestStatus, string> = {
      pending: t('signups.pending'),
      approved: t('signups.approved'),
      rejected: t('signups.rejected'),
      setup_complete: t('signups.setupComplete'),
      expired: t('signups.expired'),
    }
    return map[status]
  }

  async function handleApprove(id: string) {
    setActing(id)
    try {
      await getApi().approveSignup(id)
      await queryClient.invalidateQueries({ queryKey: qk.signupRequests })
    } finally {
      setActing(null)
    }
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) return
    setActing(id)
    try {
      await getApi().rejectSignup(id, rejectReason.trim())
      await queryClient.invalidateQueries({ queryKey: qk.signupRequests })
      setRejectingId(null)
      setRejectReason('')
    } finally {
      setActing(null)
    }
  }

  function copyLink(url: string, id: string) {
    void navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function renderActions(req: SignupRequestListItem) {
    if (req.status === 'pending') {
      if (rejectingId === req.id) {
        return (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('signups.rejectReason')}
              className="h-8 rounded border border-line bg-surface px-2 text-xs text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={!rejectReason.trim() || acting === req.id}
                onClick={() => void handleReject(req.id)}
                className="rounded bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {t('common.confirm')}
              </button>
              <button
                type="button"
                onClick={() => { setRejectingId(null); setRejectReason('') }}
                className="rounded border border-line px-2.5 py-1 text-xs font-medium text-slate"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )
      }

      return (
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={acting === req.id}
            onClick={() => void handleApprove(req.id)}
            className="rounded bg-ink px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
          >
            {acting === req.id ? '…' : t('signups.approve')}
          </button>
          <button
            type="button"
            onClick={() => setRejectingId(req.id)}
            className="rounded border border-line px-2.5 py-1.5 text-xs font-medium text-slate transition-colors hover:border-danger hover:text-danger"
          >
            {t('signups.reject')}
          </button>
        </div>
      )
    }

    if (req.status === 'approved' && req.setupUrl) {
      return (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate">{t('signups.tempId')}</span>
          <span className="font-mono text-xs font-semibold text-ink">{req.tempIdentifier}</span>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              readOnly
              value={req.setupUrl}
              className="h-7 w-40 rounded border border-line bg-canvas px-1.5 font-mono text-[10px] text-slate"
            />
            <button
              type="button"
              onClick={() => copyLink(req.setupUrl!, req.id)}
              className="whitespace-nowrap rounded bg-accent px-2 py-1 text-[10px] font-medium text-white"
            >
              {copiedId === req.id ? t('signups.copied') : t('signups.copyLink')}
            </button>
          </div>
        </div>
      )
    }

    return <span className="text-xs text-slate">—</span>
  }

  return (
    <>
      <PageHeader title={t('signups.title')} description={t('signups.subtitle')} />

      <Card>
        <CardHeader title={t('signups.title')} />
        {signups.isError ? (
          <ErrorState title={t('common.error')} onRetry={() => void signups.refetch()} />
        ) : !signups.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : signups.data.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate">{t('signups.none')}</p>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>{t('signups.school')}</Th>
                  <Th>{t('signups.contact')}</Th>
                  <Th>{t('signups.country')}</Th>
                  <Th align="right">{t('signups.students')}</Th>
                  <Th>{t('signups.status')}</Th>
                  <Th align="right">{t('signups.date')}</Th>
                  <Th>{t('signups.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {signups.data.map((req) => (
                  <Tr key={req.id}>
                    <Td>
                      <span className="font-medium">{req.schoolName}</span>
                    </Td>
                    <Td>
                      <span>{req.contactName}</span>
                      <span className="block text-xs text-slate">{req.email}</span>
                      <span className="block text-xs text-slate">{req.phone}</span>
                    </Td>
                    <Td>{req.country}</Td>
                    <Td align="right">{req.studentCount ?? '—'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[req.status]}>{statusLabel(req.status)}</Badge>
                    </Td>
                    <Td align="right" className="whitespace-nowrap text-xs text-slate">
                      {new Date(req.createdAt).toLocaleDateString(intlLocale, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Td>
                    <Td>{renderActions(req)}</Td>
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
