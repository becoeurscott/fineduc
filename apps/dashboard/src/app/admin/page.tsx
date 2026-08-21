'use client'

import { useQuery } from '@tanstack/react-query'
import {
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
import { ROLE_LABEL } from '@/lib/i18n'
import { PageHeader } from '@/components/shell'

export default function AdminPage() {
  const { t, intlLocale, locale } = useApp()
  const staff = useQuery({ queryKey: qk.staff, queryFn: () => getApi().listStaff() })
  const years = useQuery({ queryKey: qk.academicYears, queryFn: () => getApi().listAcademicYears() })
  const settings = useQuery({ queryKey: qk.settings, queryFn: () => getApi().getSettings() })
  const audit = useQuery({ queryKey: qk.auditLog({}), queryFn: () => getApi().listAuditLog({}) })

  return (
    <>
      <PageHeader title={t('admin.title')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('admin.users')} />
          {staff.isError ? (
            <ErrorState title={t('common.error')} onRetry={() => void staff.refetch()} />
          ) : !staff.data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <TableScroll className="px-1 pb-2">
              <Table className="min-w-[28rem]">
                <thead>
                  <tr>
                    <Th>Nom</Th>
                    <Th>{t('admin.role')}</Th>
                    <Th align="center">{t('admin.twoFactor')}</Th>
                    <Th align="right">{t('admin.lastLogin')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {staff.data.map((user) => (
                    <Tr key={user.id}>
                      <Td>
                        <span className="font-medium">{user.name}</span>
                        <span className="block text-xs text-slate">{user.email}</span>
                      </Td>
                      <Td>
                        <Badge tone={user.role === 'director' ? 'accent' : 'neutral'}>
                          {ROLE_LABEL[locale][user.role]}
                        </Badge>
                      </Td>
                      <Td align="center">
                        {/* 2FA is mandatory for Director and Bursar
                            (ARCHITECTURE.md §10) — a missing one is a real gap. */}
                        {user.twoFactorEnabled ? (
                          <Badge tone="positive">Actif</Badge>
                        ) : user.role === 'director' || user.role === 'bursar' ? (
                          <Badge tone="danger">Requis</Badge>
                        ) : (
                          <span className="text-xs text-slate">—</span>
                        )}
                      </Td>
                      <Td align="right" className="whitespace-nowrap text-xs text-slate">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short' })
                          : '—'}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('admin.years')} />
            {!years.data ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <TableScroll className="px-1 pb-2">
                <Table className="min-w-0">
                  <tbody>
                    {years.data.map((year) => (
                      <Tr key={year.id}>
                        <Td className="font-medium">{year.name}</Td>
                        <Td className="text-slate">{year.studentCount ?? 0} élèves</Td>
                        <Td align="right">
                          <Badge tone={year.status === 'active' ? 'positive' : 'neutral'}>
                            {year.status === 'active' ? 'Active' : 'Clôturée'}
                          </Badge>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>

          <Card>
            <CardHeader title={t('admin.settings')} />
            <CardBody className="pt-2">
              {!settings.data ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                  <dt className="text-slate">Devise</dt>
                  <dd className="font-medium">{settings.data.currency}</dd>
                  <dt className="text-slate">Fuseau</dt>
                  <dd className="font-medium">{settings.data.timezone}</dd>
                  <dt className="text-slate">Heures calmes</dt>
                  <dd className="font-medium">
                    {settings.data.quietHoursStart} – {settings.data.quietHoursEnd}
                  </dd>
                  <dt className="text-slate">Max msg / parent / jour</dt>
                  <dd className="font-medium">{settings.data.maxMessagesPerGuardianPerDay}</dd>
                  <dt className="text-slate">Frais agrégateur</dt>
                  <dd className="font-medium">
                    {settings.data.aggregatorFeeBorneBy === 'payer' ? 'À la charge du parent' : "À la charge de l'école"}
                  </dd>
                  <dt className="text-slate">Formule</dt>
                  <dd className="font-medium capitalize">{settings.data.plan}</dd>
                </dl>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t('admin.audit')}
          description="Journal en ajout seul — aucune ligne ne peut être modifiée ni supprimée."
        />
        {!audit.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('admin.actor')}</Th>
                  <Th>{t('admin.action')}</Th>
                  <Th>{t('admin.entity')}</Th>
                  <Th align="right">IP</Th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap text-slate">
                      {new Date(entry.occurredAt).toLocaleString(intlLocale, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Td>
                    <Td>
                      {entry.actorName ?? '—'}
                      {entry.actorRole ? (
                        <span className="ml-1.5 text-xs text-slate">{ROLE_LABEL[locale][entry.actorRole]}</span>
                      ) : null}
                    </Td>
                    <Td className="font-mono text-xs">{entry.action}</Td>
                    <Td className="text-slate">{entry.entityType}</Td>
                    <Td align="right" className="font-mono text-xs text-slate">
                      {entry.ip ?? '—'}
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
