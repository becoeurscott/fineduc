import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { assertCurrencyCode } from '@fineduc/money'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  assertEditable,
  assertPublishable,
  computeScheduleTotal,
  expandInstalments,
  type FeeItem,
} from '@fineduc/domain'
import type {
  CreateFeeScheduleRequest,
  ReplaceFeeItemsRequest,
  SetInstalmentPlanRequest,
} from '@fineduc/contracts'
import { Money } from '@fineduc/money'

/**
 * Building and publishing a grille tarifaire (ARCHITECTURE.md §6).
 *
 * The whole shape of this service follows from one rule: a schedule is
 * mutable while it is a DRAFT and frozen the moment it is published. Every
 * write method asserts that first. Publishing is the one-way door — an
 * invoice raised in September has to still be explainable in June, and it
 * cannot be if the prices behind it moved in between.
 *
 * "Correcting" a published schedule therefore means creating the next
 * VERSION of it, which `createVersion` does by copying the current one back
 * into draft. Invoices already raised keep pointing at the old version, as
 * they must.
 */
@Injectable()
export class FeeScheduleService {
  async createDraft(
    tx: TenantTransactionClient,
    tenantId: string,
    input: CreateFeeScheduleRequest,
  ): Promise<{ id: string; version: number }> {
    const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId } })
    if (!year || year.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', input.academicYearId)
    }
    const grade = await tx.gradeLevel.findUnique({ where: { id: input.gradeLevelId } })
    if (!grade || grade.tenantId !== tenantId) {
      throw new NotFoundError('grade_level', input.gradeLevelId)
    }

    // A second DRAFT for the same year+grade is almost always a
    // double-submit or a forgotten tab, and letting two exist means someone
    // eventually publishes the wrong one.
    const existingDraft = await tx.feeSchedule.findFirst({
      where: {
        tenantId,
        academicYearId: input.academicYearId,
        gradeLevelId: input.gradeLevelId,
        status: 'draft',
      },
    })
    if (existingDraft) {
      throw new ConflictError(
        'FEE_SCHEDULE_DRAFT_EXISTS',
        `A draft fee schedule already exists for this grade and year (${existingDraft.id}). Edit or delete it instead.`,
      )
    }

    const latest = await tx.feeSchedule.findFirst({
      where: { tenantId, academicYearId: input.academicYearId, gradeLevelId: input.gradeLevelId },
      orderBy: { version: 'desc' },
    })

    const created = await tx.feeSchedule.create({
      data: {
        tenantId,
        academicYearId: input.academicYearId,
        gradeLevelId: input.gradeLevelId,
        name: input.name,
        version: (latest?.version ?? 0) + 1,
        effectiveFrom: new Date(input.effectiveFrom),
        status: 'draft',
        // Recomputed from the items on every write; zero until they arrive.
        totalMinor: 0n,
      },
    })
    return { id: created.id, version: created.version }
  }

  /**
   * Replace the draft's items wholesale.
   *
   * Replace rather than patch: a fee schedule is read as one document by the
   * person setting prices, and a partial update leaves them guessing which
   * of the old rows survived.
   */
  async replaceItems(
    tx: TenantTransactionClient,
    tenantId: string,
    feeScheduleId: string,
    input: ReplaceFeeItemsRequest,
  ): Promise<{ totalMinor: bigint }> {
    const { schedule, currency } = await this.loadDraft(tx, tenantId, feeScheduleId)

    const items: FeeItem[] = input.items.map((item) => ({
      id: '',
      code: item.code,
      label: item.label,
      category: item.category,
      amountMinor: BigInt(item.amountMinor),
      isMandatory: item.isMandatory ?? true,
      isRecurring: item.isRecurring ?? true,
      sequence: item.sequence,
    }))

    const seenSequence = new Set<number>()
    for (const item of items) {
      if (seenSequence.has(item.sequence)) {
        throw new ValidationError('fee_item_duplicate_sequence', `Duplicate fee item sequence ${item.sequence}.`)
      }
      seenSequence.add(item.sequence)
    }
    // Same rules publishing will apply, enforced now so the error arrives
    // while the person is still looking at the form.
    assertPublishable(items, currency)

    await tx.feeItem.deleteMany({ where: { tenantId, feeScheduleId } })
    for (const item of items) {
      await tx.feeItem.create({
        data: {
          tenantId,
          feeScheduleId,
          code: item.code,
          label: item.label,
          category: item.category,
          amountMinor: item.amountMinor,
          isMandatory: item.isMandatory,
          isRecurring: item.isRecurring,
          sequence: item.sequence,
        },
      })
    }

    const totalMinor = computeScheduleTotal(items, currency).amount
    await tx.feeSchedule.update({ where: { id: schedule.id }, data: { totalMinor } })
    return { totalMinor }
  }

  /**
   * Set the instalment plan. Validated by actually EXPANDING it against the
   * current total — a plan whose percentages do not reach 100%, or whose
   * fixed tranches overshoot, is rejected here rather than at the first
   * enrolment, when a parent is waiting at the desk.
   */
  async setInstalmentPlan(
    tx: TenantTransactionClient,
    tenantId: string,
    feeScheduleId: string,
    input: SetInstalmentPlanRequest,
  ): Promise<{ instalmentCount: number }> {
    const { schedule, currency } = await this.loadDraft(tx, tenantId, feeScheduleId)

    if (schedule.totalMinor <= 0n) {
      throw new ConflictError(
        'FEE_SCHEDULE_HAS_NO_ITEMS',
        'Add fee items before setting the instalment plan — the plan is validated against the total.',
      )
    }

    expandInstalments(
      input.templates.map((t) => ({
        sequence: t.sequence,
        label: t.label,
        dueOffsetDays: t.dueOffsetDays ?? null,
        dueOn: t.dueOn ?? null,
        percentBp: t.percentBp ?? null,
        amountMinor: t.amountMinor != null ? BigInt(t.amountMinor) : null,
      })),
      Money.of(schedule.totalMinor, currency),
      // Any anchor works for validation; only the AMOUNTS are being checked
      // here, and the real dates come from each enrolment.
      { anchorDate: '2000-01-01' },
    )

    await tx.instalmentPlan.deleteMany({ where: { tenantId, feeScheduleId } })
    const plan = await tx.instalmentPlan.create({
      data: { tenantId, feeScheduleId, name: input.name, instalmentCount: input.templates.length },
    })
    for (const template of input.templates) {
      await tx.instalmentTemplate.create({
        data: {
          tenantId,
          instalmentPlanId: plan.id,
          sequence: template.sequence,
          label: template.label,
          dueOffsetDays: template.dueOffsetDays ?? null,
          dueOn: template.dueOn ? new Date(template.dueOn) : null,
          percentBp: template.percentBp ?? null,
          amountMinor: template.amountMinor != null ? BigInt(template.amountMinor) : null,
        },
      })
    }

    return { instalmentCount: input.templates.length }
  }

  /**
   * The one-way door. After this the schedule can be invoiced against and
   * can never be edited again.
   */
  async publish(
    tx: TenantTransactionClient,
    tenantId: string,
    feeScheduleId: string,
  ): Promise<{ id: string; version: number; totalMinor: bigint }> {
    const { schedule, currency } = await this.loadDraft(tx, tenantId, feeScheduleId)

    const items = await tx.feeItem.findMany({ where: { tenantId, feeScheduleId } })
    assertPublishable(
      items.map((item) => ({
        id: item.id,
        code: item.code,
        label: item.label,
        category: item.category,
        amountMinor: item.amountMinor,
        isMandatory: item.isMandatory,
        isRecurring: item.isRecurring,
        sequence: item.sequence,
      })),
      currency,
    )

    // Enrolment cannot raise an invoice without a plan, so publishing
    // without one produces a schedule that looks usable and is not.
    const plan = await tx.instalmentPlan.findFirst({ where: { tenantId, feeScheduleId } })
    if (!plan) {
      throw new ConflictError(
        'FEE_SCHEDULE_HAS_NO_PLAN',
        'Set an instalment plan before publishing; enrolment cannot raise an invoice without one.',
      )
    }

    // Archive the version this one supersedes, so exactly one published
    // schedule per grade+year is invoiceable at a time.
    await tx.feeSchedule.updateMany({
      where: {
        tenantId,
        academicYearId: schedule.academicYearId,
        gradeLevelId: schedule.gradeLevelId,
        status: 'published',
      },
      data: { status: 'archived' },
    })

    const published = await tx.feeSchedule.update({
      where: { id: feeScheduleId },
      data: { status: 'published' },
    })

    return { id: published.id, version: published.version, totalMinor: published.totalMinor }
  }

  /**
   * Start the next version by copying a published schedule back into draft.
   * The published one is untouched; invoices already raised against it keep
   * pointing at it, which is the entire reason versions exist.
   */
  async createVersion(
    tx: TenantTransactionClient,
    tenantId: string,
    feeScheduleId: string,
    effectiveFrom: string,
  ): Promise<{ id: string; version: number }> {
    const source = await tx.feeSchedule.findUnique({
      where: { id: feeScheduleId },
      include: { feeItems: true, instalmentPlans: { include: { templates: true } } },
    })
    if (!source || source.tenantId !== tenantId) {
      throw new NotFoundError('fee_schedule', feeScheduleId)
    }
    if (source.status === 'draft') {
      throw new ConflictError(
        'FEE_SCHEDULE_ALREADY_DRAFT',
        'This schedule is still a draft — edit it directly instead of versioning it.',
      )
    }

    const latest = await tx.feeSchedule.findFirst({
      where: { tenantId, academicYearId: source.academicYearId, gradeLevelId: source.gradeLevelId },
      orderBy: { version: 'desc' },
    })

    const draft = await tx.feeSchedule.create({
      data: {
        tenantId,
        academicYearId: source.academicYearId,
        gradeLevelId: source.gradeLevelId,
        name: source.name,
        version: (latest?.version ?? source.version) + 1,
        effectiveFrom: new Date(effectiveFrom),
        status: 'draft',
        totalMinor: source.totalMinor,
      },
    })

    for (const item of source.feeItems) {
      await tx.feeItem.create({
        data: {
          tenantId,
          feeScheduleId: draft.id,
          code: item.code,
          label: item.label,
          category: item.category,
          amountMinor: item.amountMinor,
          isMandatory: item.isMandatory,
          isRecurring: item.isRecurring,
          sequence: item.sequence,
        },
      })
    }

    const sourcePlan = source.instalmentPlans[0]
    if (sourcePlan) {
      const plan = await tx.instalmentPlan.create({
        data: {
          tenantId,
          feeScheduleId: draft.id,
          name: sourcePlan.name,
          instalmentCount: sourcePlan.instalmentCount,
        },
      })
      for (const template of sourcePlan.templates) {
        await tx.instalmentTemplate.create({
          data: {
            tenantId,
            instalmentPlanId: plan.id,
            sequence: template.sequence,
            label: template.label,
            dueOffsetDays: template.dueOffsetDays,
            dueOn: template.dueOn,
            percentBp: template.percentBp,
            amountMinor: template.amountMinor,
          },
        })
      }
    }

    return { id: draft.id, version: draft.version }
  }

  /** Load a schedule and refuse if it is not still editable. */
  private async loadDraft(tx: TenantTransactionClient, tenantId: string, feeScheduleId: string) {
    const schedule = await tx.feeSchedule.findUnique({ where: { id: feeScheduleId } })
    if (!schedule || schedule.tenantId !== tenantId) {
      throw new NotFoundError('fee_schedule', feeScheduleId)
    }
    assertEditable(schedule)

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)

    return { schedule, currency: assertCurrencyCode(tenant.currency) }
  }
}
