import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { ConflictError, NotFoundError, InvalidStateError } from '@fineduc/domain'
import type {
  CreateAcademicYearRequest,
  UpdateAcademicYearRequest,
  CreateTermRequest,
  AcademicYear,
  Term,
} from '@fineduc/contracts'

@Injectable()
export class AcademicYearService {
  /**
   * List all academic years for this tenant, ordered by start date descending.
   */
  async list(tx: TenantTransactionClient, tenantId: string): Promise<AcademicYear[]> {
    const years = await tx.academicYear.findMany({
      where: { tenantId },
      orderBy: { startsOn: 'desc' },
    })

    return years.map((y) => ({
      id: y.id,
      tenantId: y.tenantId,
      name: y.name,
      startsOn: y.startsOn.toISOString().split('T')[0] as string,
      endsOn: y.endsOn.toISOString().split('T')[0] as string,
      status: y.status,
      createdAt: y.createdAt.toISOString(),
      updatedAt: y.updatedAt.toISOString(),
    }))
  }

  /**
   * Get an academic year by ID.
   */
  async get(tx: TenantTransactionClient, tenantId: string, id: string): Promise<AcademicYear> {
    const year = await tx.academicYear.findUnique({
      where: { id },
    })
    if (!year || year.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', id)
    }

    return {
      id: year.id,
      tenantId: year.tenantId,
      name: year.name,
      startsOn: year.startsOn.toISOString().split('T')[0] as string,
      endsOn: year.endsOn.toISOString().split('T')[0] as string,
      status: year.status,
      createdAt: year.createdAt.toISOString(),
      updatedAt: year.updatedAt.toISOString(),
    }
  }

  /**
   * Create a new academic year in `draft` status.
   */
  async create(
    tx: TenantTransactionClient,
    tenantId: string,
    input: CreateAcademicYearRequest,
  ): Promise<AcademicYear> {
    const startsOn = new Date(input.startsOn)
    const endsOn = new Date(input.endsOn)

    if (endsOn <= startsOn) {
      throw new ConflictError(
        'INVALID_DATE_RANGE',
        'Academic year endsOn must be strictly after startsOn',
      )
    }

    const year = await tx.academicYear.create({
      data: {
        tenantId,
        name: input.name,
        startsOn,
        endsOn,
        status: 'draft',
      },
    })

    return {
      id: year.id,
      tenantId: year.tenantId,
      name: year.name,
      startsOn: year.startsOn.toISOString().split('T')[0] as string,
      endsOn: year.endsOn.toISOString().split('T')[0] as string,
      status: year.status,
      createdAt: year.createdAt.toISOString(),
      updatedAt: year.updatedAt.toISOString(),
    }
  }

  /**
   * Update draft academic year details.
   */
  async update(
    tx: TenantTransactionClient,
    tenantId: string,
    id: string,
    input: UpdateAcademicYearRequest,
  ): Promise<AcademicYear> {
    const existing = await tx.academicYear.findUnique({ where: { id } })
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', id)
    }

    if (existing.status === 'closed') {
      throw new InvalidStateError(
        'YEAR_CLOSED',
        'Cannot modify an academic year that has been closed',
      )
    }

    const updated = await tx.academicYear.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.startsOn ? { startsOn: new Date(input.startsOn) } : {}),
        ...(input.endsOn ? { endsOn: new Date(input.endsOn) } : {}),
      },
    })

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      name: updated.name,
      startsOn: updated.startsOn.toISOString().split('T')[0] as string,
      endsOn: updated.endsOn.toISOString().split('T')[0] as string,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }
  }

  /**
   * Activate an academic year. If another year was active, it remains or is closed.
   * Partial unique index enforces only ONE active year per tenant (ARCHITECTURE.md §6).
   */
  async activate(tx: TenantTransactionClient, tenantId: string, id: string): Promise<AcademicYear> {
    const year = await tx.academicYear.findUnique({ where: { id } })
    if (!year || year.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', id)
    }

    if (year.status === 'closed') {
      throw new InvalidStateError('YEAR_CLOSED', 'Cannot re-activate a closed academic year')
    }

    // Set any current active year to closed first to respect the partial unique index.
    await tx.academicYear.updateMany({
      where: { tenantId, status: 'active', id: { not: id } },
      data: { status: 'closed' },
    })

    const updated = await tx.academicYear.update({
      where: { id },
      data: { status: 'active' },
    })

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      name: updated.name,
      startsOn: updated.startsOn.toISOString().split('T')[0] as string,
      endsOn: updated.endsOn.toISOString().split('T')[0] as string,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }
  }

  /**
   * Close an academic year.
   */
  async close(tx: TenantTransactionClient, tenantId: string, id: string): Promise<AcademicYear> {
    const year = await tx.academicYear.findUnique({ where: { id } })
    if (!year || year.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', id)
    }

    const updated = await tx.academicYear.update({
      where: { id },
      data: { status: 'closed' },
    })

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      name: updated.name,
      startsOn: updated.startsOn.toISOString().split('T')[0] as string,
      endsOn: updated.endsOn.toISOString().split('T')[0] as string,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }
  }

  /**
   * Add a term to an academic year.
   */
  async createTerm(
    tx: TenantTransactionClient,
    tenantId: string,
    academicYearId: string,
    input: CreateTermRequest,
  ): Promise<Term> {
    const year = await tx.academicYear.findUnique({ where: { id: academicYearId } })
    if (!year || year.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', academicYearId)
    }

    const term = await tx.term.create({
      data: {
        tenantId,
        academicYearId,
        name: input.name,
        startsOn: new Date(input.startsOn),
        endsOn: new Date(input.endsOn),
        sequence: input.sequence,
      },
    })

    return {
      id: term.id,
      tenantId: term.tenantId,
      academicYearId: term.academicYearId,
      name: term.name,
      startsOn: term.startsOn.toISOString().split('T')[0] as string,
      endsOn: term.endsOn.toISOString().split('T')[0] as string,
      sequence: term.sequence,
    }
  }

  /**
   * List terms for an academic year.
   */
  async listTerms(
    tx: TenantTransactionClient,
    tenantId: string,
    academicYearId: string,
  ): Promise<Term[]> {
    const terms = await tx.term.findMany({
      where: { tenantId, academicYearId },
      orderBy: { sequence: 'asc' },
    })

    return terms.map((t) => ({
      id: t.id,
      tenantId: t.tenantId,
      academicYearId: t.academicYearId,
      name: t.name,
      startsOn: t.startsOn.toISOString().split('T')[0] as string,
      endsOn: t.endsOn.toISOString().split('T')[0] as string,
      sequence: t.sequence,
    }))
  }
}
