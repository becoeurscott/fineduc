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

export default function RemindersPage() {
  const { t, intlLocale } = useApp()
  const rules = useQuery({ queryKey: qk.reminderRules, queryFn: () => getApi().listReminderRules() })
  const templates = useQuery({ queryKey: qk.messageTemplates, queryFn: () => getApi().listMessageTemplates() })
  const log = useQuery({ queryKey: qk.messageLog, queryFn: () => getApi().listMessageLog() })
  const credits = useQuery({ queryKey: qk.messageCredits, queryFn: () => getApi().getMessageCredits() })

  const offsetLabel = (days: number) =>
    days === 0 ? t('reminders.onDueDate') : days < 0 ? `J${days} — ${t('reminders.beforeDue')}` : `J+${days} — ${t('reminders.afterDue')}`

  return (
    <>
      <PageHeader title={t('reminders.title')} />

      {credits.data ? (
        <Card className="mb-4">
          <CardHeader title={t('reminders.credits')} />
          <CardBody className="pt-2">
            {credits.data.lowBalanceWarning ? (
              <p className="mb-3 rounded-[var(--radius-control)] border border-warning-soft bg-warning-soft/20 px-3 py-2 text-xs text-ink">
                ! {t('reminders.lowBalance')}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate">{t('reminders.balance')}</p>
                <Amount value={credits.data.balance} locale={intlLocale} size="lg" className="mt-0.5 block" />
              </div>
              <div>
                <p className="text-xs text-slate">{t('reminders.sentThisMonth')}</p>
                <p className="mt-0.5 text-xl font-semibold text-ink">{credits.data.sentThisMonth}</p>
              </div>
              <div>
                <p className="text-xs text-slate">WhatsApp</p>
                <Amount value={credits.data.whatsappUnitCost} locale={intlLocale} size="md" className="mt-0.5 block" />
              </div>
              <div>
                <p className="text-xs text-slate">SMS</p>
                <Amount value={credits.data.smsUnitCost} locale={intlLocale} size="md" className="mt-0.5 block" />
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Skeleton className="mb-4 h-32 rounded-[var(--radius-card)]" />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('reminders.rules')}
            description="Chaque règle est évaluée au moment de l’envoi, jamais à la planification."
          />
          {rules.isError ? (
            <ErrorState title={t('common.error')} onRetry={() => void rules.refetch()} />
          ) : !rules.data ? (
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
                    <Th>Règle</Th>
                    <Th>Déclenchement</Th>
                    <Th>Canal</Th>
                    <Th align="right">{t('common.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data.map((rule) => (
                    <Tr key={rule.id}>
                      <Td className="font-medium">{rule.name}</Td>
                      <Td className="text-slate">{offsetLabel(rule.offsetDays)}</Td>
                      <Td>
                        <Badge tone={rule.channel === 'whatsapp' ? 'positive' : 'neutral'}>{rule.channel}</Badge>
                      </Td>
                      <Td align="right">
                        <Badge tone={rule.isActive ? 'accent' : 'neutral'}>{rule.isActive ? 'Active' : 'Inactive'}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>

        <Card>
          <CardHeader title={t('reminders.templates')} />
          <CardBody className="space-y-3 pt-2">
            {!templates.data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              templates.data.map((template) => (
                <div key={template.id} className="rounded-[var(--radius-control)] border border-line p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-ink">{template.code}</span>
                    <Badge tone="neutral">{template.locale.toUpperCase()}</Badge>
                    <Badge tone={template.channel === 'whatsapp' ? 'positive' : 'neutral'}>{template.channel}</Badge>
                    {/* Meta pre-approval gates whether this can send at all. */}
                    {template.whatsappTemplateStatus ? (
                      <Badge
                        tone={
                          template.whatsappTemplateStatus === 'approved'
                            ? 'positive'
                            : template.whatsappTemplateStatus === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        Meta : {template.whatsappTemplateStatus}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs leading-relaxed text-slate">{template.body}</p>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('reminders.log')} />
        {!log.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('common.student')}</Th>
                  <Th>Destinataire</Th>
                  <Th>Canal</Th>
                  <Th align="right">{t('common.status')}</Th>
                  <Th align="right">Coût</Th>
                </tr>
              </thead>
              <tbody>
                {log.data.map((message) => (
                  <Tr key={message.id}>
                    <Td className="whitespace-nowrap text-slate">
                      {message.sentAt
                        ? new Date(message.sentAt).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short' })
                        : '—'}
                    </Td>
                    <Td>{message.studentName ?? '—'}</Td>
                    <Td className="text-slate">{message.toPhoneE164}</Td>
                    <Td>
                      <Badge tone={message.channel === 'whatsapp' ? 'positive' : 'neutral'}>{message.channel}</Badge>
                    </Td>
                    <Td align="right">
                      <Badge tone={message.status === 'failed' ? 'danger' : message.status === 'read' ? 'accent' : 'neutral'}>
                        {message.status}
                        {message.errorCode ? ` · ${message.errorCode}` : ''}
                      </Badge>
                    </Td>
                    <Td align="right">
                      <Amount value={message.cost} locale={intlLocale} size="sm" />
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
