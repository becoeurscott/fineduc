'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MoratoriumListItem, MoratoriumPolicy } from '@fineduc/contracts'
import { Amount, Badge, Card, CardBody, CardHeader, ErrorState, Skeleton } from '@fineduc/ui'
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'

/**
 * The bursar's queue, and the rules behind it (ARCHITECTURE.md §8.5b).
 *
 * Mobile-first at 360px: a director decides this from a phone, often between
 * other things, so each request is a card that answers "who, how much, until
 * when, and have they asked before" without scrolling sideways.
 *
 * **No optimistic UI.** A moratoire is not money, but it moves a date a
 * family will plan around, and depending on the school's own rules a refusal
 * may be final. It gets the same treatment as a payment: a spinner, then the
 * server's answer.
 */
export default function MoratoiresPage() {
  const { t } = useApp()
  const client = useQueryClient()

  const pending = useQuery({
    queryKey: qk.moratoriums('pending'),
    queryFn: () => getApi().listMoratoriums('pending'),
  })
  const policy = useQuery({ queryKey: qk.moratoriumPolicy, queryFn: () => getApi().getMoratoriumPolicy() })

  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'refuse'; note: string }) =>
      input.action === 'approve'
        ? getApi().approveMoratorium(input.id, input.note || undefined)
        : getApi().refuseMoratorium(input.id, input.note),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['moratoriums'] })
    },
  })

  return (
    <>
      <PageHeader title={t('moratoires.title')} />

      <Card className="mb-4">
        <CardHeader title={`${t('moratoires.pending')} (${pending.data?.length ?? 0})`} />
        <CardBody className="pt-2">
          {pending.isLoading ? <Skeleton className="h-24 w-full" /> : null}
          {pending.isError ? <ErrorState title={t('common.error')} onRetry={() => void pending.refetch()} /> : null}
          {pending.data?.length === 0 ? <p className="text-sm text-muted">{t('moratoires.none')}</p> : null}

          <div className="flex flex-col gap-3">
            {pending.data?.map((row) => (
              <RequestCard
                key={row.id}
                row={row}
                busy={decide.isPending}
                onDecide={(action, note) => decide.mutate({ id: row.id, action, note })}
              />
            ))}
          </div>
        </CardBody>
      </Card>

      {policy.data ? <PolicyCard policy={policy.data} /> : null}
    </>
  )
}

function RequestCard({
  row,
  busy,
  onDecide,
}: {
  row: MoratoriumListItem
  busy: boolean
  onDecide: (action: 'approve' | 'refuse', note: string) => void
}) {
  const { t } = useApp()
  const [refusing, setRefusing] = useState(false)
  const [note, setNote] = useState('')

  return (
    <div className="rounded-[var(--radius-control)] border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{row.studentName}</span>
        <span className="text-sm text-muted">{row.className}</span>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="text-muted">{row.instalmentLabel}</span>
        <Amount value={row.amountDue} />
        <span className="text-muted">
          {t('moratoires.until')} <strong className="text-ink">{row.deferredDueOn}</strong>
        </span>
        {/* The original date stays visible: it is what "late" is measured from. */}
        <span className="text-muted">
          {t('moratoires.originally')} <s>{row.originalDueOn}</s>
        </span>
      </div>

      <p className="mt-2 text-sm text-muted">
        {t('moratoires.reason')} : {row.reason ?? <em>{t('moratoires.noReason')}</em>}
      </p>

      {row.priorRefusals > 0 ? (
        <p className="mt-2">
          <Badge tone="warning">{t('moratoires.priorRefusals')}</Badge>
        </p>
      ) : null}

      {refusing ? (
        <div className="mt-3 flex flex-col gap-2">
          {/*
            Required, mirroring "a cash variance cannot be closed without a
            written reason". The family is owed an explanation, and so is the
            next person to open the file.
          */}
          <label className="text-xs text-muted" htmlFor={`note-${row.id}`}>
            {t('moratoires.refuseNote')}
          </label>
          <textarea
            id={`note-${row.id}`}
            rows={2}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            className="rounded-[var(--radius-control)] border border-line p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || note.trim() === ''}
              onClick={() => onDecide('refuse', note.trim())}
              className="min-h-[44px] rounded-[var(--radius-control)] bg-danger px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('moratoires.refuse')}
            </button>
            <button
              type="button"
              onClick={() => setRefusing(false)}
              className="min-h-[44px] px-3 text-sm text-muted underline"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide('approve', '')}
            className="min-h-[44px] rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('moratoires.approve')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRefusing(true)}
            className="min-h-[44px] rounded-[var(--radius-control)] border border-line px-4 text-sm font-medium text-ink disabled:opacity-50"
          >
            {t('moratoires.refuse')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The school's rules, each with a plain sentence saying what it does.
 *
 * A director changing `refusalFreesSlot` without understanding it either
 * traps a family after one mistaken refusal or lets them ask until someone
 * says yes — so the help text is not decoration here, it is the feature.
 */
function PolicyCard({ policy }: { policy: MoratoriumPolicy }) {
  const { t } = useApp()
  const client = useQueryClient()
  const [draft, setDraft] = useState<MoratoriumPolicy>(policy)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: (next: MoratoriumPolicy) => getApi().updateMoratoriumPolicy(next),
    onSuccess: () => {
      setSaved(true)
      void client.invalidateQueries({ queryKey: qk.moratoriumPolicy })
    },
  })

  function set<K extends keyof MoratoriumPolicy>(key: K, value: MoratoriumPolicy[K]): void {
    setSaved(false)
    setDraft({ ...draft, [key]: value })
  }

  return (
    <Card>
      <CardHeader title={t('moratoires.policy')} />
      <CardBody className="flex flex-col gap-4 pt-2">
        <Toggle
          label={t('moratoires.policyEnabled')}
          help={t('moratoires.policyEnabledHelp')}
          checked={draft.enabled}
          onChange={(value) => set('enabled', value)}
        />

        <Field label={t('moratoires.policyApproval')} help={t('moratoires.policyApprovalHelp')}>
          <select
            value={draft.approval}
            onChange={(event) => set('approval', event.target.value as MoratoriumPolicy['approval'])}
            className="min-h-[44px] rounded-[var(--radius-control)] border border-line px-2 text-sm"
          >
            <option value="manual">{t('moratoires.policyApprovalManual')}</option>
            <option value="auto">{t('moratoires.policyApprovalAuto')}</option>
          </select>
        </Field>

        <Field label={t('moratoires.policyDurations')} help={t('moratoires.policyDurationsHelp')}>
          <div className="flex gap-2">
            {[7, 14, 21].map((days) => {
              const on = draft.allowedDurationsDays.includes(days)
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() =>
                    set(
                      'allowedDurationsDays',
                      on
                        ? draft.allowedDurationsDays.filter((d) => d !== days)
                        : [...draft.allowedDurationsDays, days].sort((a, b) => a - b),
                    )
                  }
                  className={`min-h-[44px] rounded-[var(--radius-control)] border px-3 text-sm ${
                    on ? 'border-accent bg-accent text-white' : 'border-line text-ink'
                  }`}
                >
                  {days} {t('moratoires.days')}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label={t('moratoires.policyOfferFrom')} help={t('moratoires.policyOfferFromHelp')}>
          <NumberInput
            value={draft.offerFromDaysBeforeDue}
            min={1}
            max={60}
            onChange={(value) => set('offerFromDaysBeforeDue', value)}
          />
        </Field>

        <Field label={t('moratoires.policyGrace')} help={t('moratoires.policyGraceHelp')}>
          <NumberInput value={draft.lateGraceDays} min={0} max={21} onChange={(value) => set('lateGraceDays', value)} />
        </Field>

        <Toggle
          label={t('moratoires.policyRefusal')}
          help={t('moratoires.policyRefusalHelp')}
          checked={draft.refusalFreesSlot}
          onChange={(value) => set('refusalFreesSlot', value)}
        />

        {/* Stated as a fact, not offered as a field. */}
        <p className="text-xs text-muted">{t('moratoires.policyCap')}</p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate(draft)}
            className="min-h-[44px] rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('moratoires.policySave')}
          </button>
          {saved ? <span className="text-sm text-success">{t('moratoires.policySaved')}</span> : null}
        </div>
      </CardBody>
    </Card>
  )
}

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      <span className="text-xs text-muted">{help}</span>
    </div>
  )
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="size-5"
        />
        {label}
      </span>
      <span className="pl-7 text-xs text-muted">{help}</span>
    </label>
  )
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(event) => onChange(Number(event.target.value))}
      className="min-h-[44px] w-24 rounded-[var(--radius-control)] border border-line px-2 text-sm"
    />
  )
}
