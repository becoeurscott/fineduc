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
import type {
  SignupRequestListItem,
  SignupRequestStatus,
  ApproveSignupResponse,
} from '@fineduc/contracts'

/**
 * The admin relays these by hand over WhatsApp, so the message is built here
 * rather than left to them to retype — a mistyped code reads as a broken
 * product to the school, and they cannot check it against anything.
 */
function whatsappUrl(phone: string, schoolName: string, creds: ApproveSignupResponse): string {
  const message = [
    `Bonjour, votre demande pour ${schoolName} est validée.`,
    '',
    `Identifiant école : ${creds.tempIdentifier}`,
    `E-mail temporaire : ${creds.tempEmail}`,
    `Code d'accès : ${creds.tempCode}`,
    '',
    `Connectez-vous ici : ${creds.loginUrl}`,
    '',
    'À la première connexion, vous remplacerez cet e-mail temporaire par celui de votre école.',
  ].join('\n')

  return `https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(message)}`
}

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
  /*
   * Credentials live only in this component's state. The code is returned
   * once by the API and stored hashed, so a refresh loses it for good —
   * which is why the panel says so and offers a reissue instead of pretending
   * it can be looked up again.
   */
  const [issued, setIssued] = useState<Record<string, ApproveSignupResponse>>({})

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
      const creds = await getApi().approveSignup(id)
      setIssued((prev) => ({ ...prev, [id]: creds }))
      await queryClient.invalidateQueries({ queryKey: qk.signupRequests })
    } finally {
      setActing(null)
    }
  }

  async function handleReissue(id: string) {
    setActing(id)
    try {
      const creds = await getApi().reissueCode(id)
      setIssued((prev) => ({ ...prev, [id]: creds }))
    } finally {
      setActing(null)
    }
  }

  function copyCredentials(req: SignupRequestListItem, creds: ApproveSignupResponse) {
    void navigator.clipboard.writeText(
      [
        `${req.schoolName}`,
        `Identifiant : ${creds.tempIdentifier}`,
        `E-mail temporaire : ${creds.tempEmail}`,
        `Code d'accès : ${creds.tempCode}`,
        `Connexion : ${creds.loginUrl}`,
      ].join('\n'),
    )
    setCopiedId(req.id)
    setTimeout(() => setCopiedId(null), 2000)
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

    if (req.status === 'approved') {
      const creds = issued[req.id]

      // The code is gone after a refresh — by design. Show what survives in
      // the database and offer the only real remedy.
      if (!creds) {
        return (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate">
              {t('signups.tempId')}
            </span>
            <span className="font-mono text-xs font-semibold text-ink">{req.tempIdentifier}</span>
            <span className="font-mono text-[10px] text-slate">{req.tempEmail}</span>
            <button
              type="button"
              disabled={acting === req.id}
              onClick={() => void handleReissue(req.id)}
              className="mt-1.5 w-fit rounded border border-line px-2 py-1 text-[10px] font-medium text-slate transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
              title={t('signups.reissueWarning')}
            >
              {acting === req.id ? '…' : t('signups.reissue')}
            </button>
          </div>
        )
      }

      return (
        <div className="flex w-64 flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 p-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
            {t('signups.credentials')}
          </span>

          <dl className="flex flex-col gap-1.5">
            <div>
              <dt className="text-[10px] text-slate">{t('signups.tempId')}</dt>
              <dd className="font-mono text-xs font-semibold text-ink">{creds.tempIdentifier}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-slate">{t('signups.tempEmail')}</dt>
              <dd className="font-mono text-[11px] break-all text-ink">{creds.tempEmail}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-slate">{t('signups.tempCode')}</dt>
              <dd className="font-mono text-sm font-bold tracking-wider text-ink">{creds.tempCode}</dd>
            </div>
          </dl>

          <p className="text-[10px] leading-snug text-slate">{t('signups.credentialsOnce')}</p>

          <div className="flex flex-wrap gap-1.5">
            <a
              href={whatsappUrl(req.phone, req.schoolName, creds)}
              target="_blank"
              rel="noreferrer"
              className="rounded bg-positive px-2 py-1 text-[10px] font-medium text-white"
            >
              {t('signups.sendWhatsapp')}
            </a>
            <button
              type="button"
              onClick={() => copyCredentials(req, creds)}
              className="rounded bg-ink px-2 py-1 text-[10px] font-medium text-white"
            >
              {copiedId === req.id ? t('signups.copied') : t('signups.copyAll')}
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
