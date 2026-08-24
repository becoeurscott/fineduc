'use client'

import { useQuery } from '@tanstack/react-query'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@fineduc/ui'
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'
import type { SignupRequestStatus } from '@fineduc/contracts'

const STATUS_TONE: Record<SignupRequestStatus, 'neutral' | 'warning' | 'accent' | 'positive' | 'danger'> = {
  pending: 'warning',
  approved: 'accent',
  rejected: 'danger',
  setup_complete: 'positive',
  expired: 'neutral',
}

export default function OverviewPage() {
  const { t } = useApp()
  const signups = useQuery({
    queryKey: qk.signupRequests,
    queryFn: () => getApi().listSignupRequests(),
  })

  const pending = signups.data?.filter((r) => r.status === 'pending').length ?? 0
  const approved = signups.data?.filter((r) => r.status === 'approved').length ?? 0
  const completed = signups.data?.filter((r) => r.status === 'setup_complete').length ?? 0
  const total = signups.data?.length ?? 0

  return (
    <>
      <PageHeader title={t('nav.overview')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t('signups.pending'), value: pending, tone: 'warning' as const },
          { label: t('signups.approved'), value: approved, tone: 'accent' as const },
          { label: t('signups.setupComplete'), value: completed, tone: 'positive' as const },
          { label: 'Total', value: total, tone: 'neutral' as const },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardBody className="py-4">
              {!signups.data ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <>
                  <p className="text-sm text-slate">{stat.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{stat.value}</p>
                  <Badge tone={stat.tone}>{stat.label}</Badge>
                </>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      {signups.data && signups.data.filter((r) => r.status === 'pending').length > 0 && (
        <Card className="mt-6">
          <CardHeader title={`${pending} demande(s) en attente`} />
          <CardBody>
            <ul className="divide-y divide-line">
              {signups.data.filter((r) => r.status === 'pending').map((req) => (
                <li key={req.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{req.schoolName}</p>
                    <p className="text-xs text-slate">{req.contactName} — {req.country} — {req.studentCount ?? '?'} élèves</p>
                  </div>
                  <Badge tone={STATUS_TONE[req.status]}>{t('signups.pending')}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  )
}
