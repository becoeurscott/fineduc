import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { NotFoundError } from '@fineduc/domain'
import type {
  CreateGradeLevelRequest,
  UpdateGradeLevelRequest,
  CreateClassGroupRequest,
  UpdateClassGroupRequest,
  GradeLevel,
  ClassGroup,
} from '@fineduc/contracts'

@Injectable()
export class ClassGroupService {
  /**
   * List all grade levels for this tenant.
   */
  async listGradeLevels(tx: TenantTransactionClient, tenantId: string): Promise<GradeLevel[]> {
    const levels = await tx.gradeLevel.findMany({
      where: { tenantId },
      orderBy: { sequence: 'asc' },
    })

    return levels.map((l) => ({
      id: l.id,
      tenantId: l.tenantId,
      name: l.name,
      sequence: l.sequence,
      cycle: l.cycle,
    }))
  }

  /**
   * Create a grade level (e.g. "6ème", "CM2").
   */
  async createGradeLevel(
    tx: TenantTransactionClient,
    tenantId: string,
    input: CreateGradeLevelRequest,
  ): Promise<GradeLevel> {
    const level = await tx.gradeLevel.create({
      data: {
        tenantId,
        name: input.name,
        sequence: input.sequence,
        cycle: input.cycle ?? null,
      },
    })

    return {
      id: level.id,
      tenantId: level.tenantId,
      name: level.name,
      sequence: level.sequence,
      cycle: level.cycle,
    }
  }

  /**
   * Update a grade level.
   */
  async updateGradeLevel(
    tx: TenantTransactionClient,
    tenantId: string,
    id: string,
    input: UpdateGradeLevelRequest,
  ): Promise<GradeLevel> {
    const existing = await tx.gradeLevel.findUnique({ where: { id } })
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError('grade_level', id)
    }

    const updated = await tx.gradeLevel.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.sequence ? { sequence: input.sequence } : {}),
        ...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
      },
    })

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      name: updated.name,
      sequence: updated.sequence,
      cycle: updated.cycle,
    }
  }

  /**
   * List class groups, optionally filtered by academic year or site.
   */
  async listClassGroups(
    tx: TenantTransactionClient,
    tenantId: string,
    academicYearId?: string,
    siteId?: string,
  ): Promise<ClassGroup[]> {
    const groups = await tx.classGroup.findMany({
      where: {
        tenantId,
        ...(academicYearId ? { academicYearId } : {}),
        ...(siteId ? { siteId } : {}),
      },
      include: {
        gradeLevel: { select: { name: true } },
        academicYear: { select: { name: true } },
        site: { select: { name: true } },
      },
      orderBy: [{ gradeLevel: { sequence: 'asc' } }, { name: 'asc' }],
    })

    return groups.map((g) => ({
      id: g.id,
      tenantId: g.tenantId,
      gradeLevelId: g.gradeLevelId,
      gradeLevelName: g.gradeLevel.name,
      academicYearId: g.academicYearId,
      academicYearName: g.academicYear.name,
      siteId: g.siteId,
      siteName: g.site.name,
      name: g.name,
      capacity: g.capacity,
      headTeacherName: g.headTeacherName,
    }))
  }

  /**
   * Create a concrete class group (e.g. "6ème A" for 2026/2027 at Site 1).
   */
  async createClassGroup(
    tx: TenantTransactionClient,
    tenantId: string,
    input: CreateClassGroupRequest,
  ): Promise<ClassGroup> {
    // Validate referenced entities exist under this tenant
    const gradeLevel = await tx.gradeLevel.findUnique({ where: { id: input.gradeLevelId } })
    if (!gradeLevel || gradeLevel.tenantId !== tenantId) {
      throw new NotFoundError('grade_level', input.gradeLevelId)
    }

    const academicYear = await tx.academicYear.findUnique({ where: { id: input.academicYearId } })
    if (!academicYear || academicYear.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', input.academicYearId)
    }

    const site = await tx.site.findUnique({ where: { id: input.siteId } })
    if (!site || site.tenantId !== tenantId) {
      throw new NotFoundError('site', input.siteId)
    }

    const group = await tx.classGroup.create({
      data: {
        tenantId,
        gradeLevelId: input.gradeLevelId,
        academicYearId: input.academicYearId,
        siteId: input.siteId,
        name: input.name,
        capacity: input.capacity ?? null,
        headTeacherName: input.headTeacherName ?? null,
      },
      include: {
        gradeLevel: { select: { name: true } },
        academicYear: { select: { name: true } },
        site: { select: { name: true } },
      },
    })

    return {
      id: group.id,
      tenantId: group.tenantId,
      gradeLevelId: group.gradeLevelId,
      gradeLevelName: group.gradeLevel.name,
      academicYearId: group.academicYearId,
      academicYearName: group.academicYear.name,
      siteId: group.siteId,
      siteName: group.site.name,
      name: group.name,
      capacity: group.capacity,
      headTeacherName: group.headTeacherName,
    }
  }

  /**
   * Update class group details.
   */
  async updateClassGroup(
    tx: TenantTransactionClient,
    tenantId: string,
    id: string,
    input: UpdateClassGroupRequest,
  ): Promise<ClassGroup> {
    const existing = await tx.classGroup.findUnique({ where: { id } })
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError('class_group', id)
    }

    const updated = await tx.classGroup.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.headTeacherName !== undefined ? { headTeacherName: input.headTeacherName } : {}),
      },
      include: {
        gradeLevel: { select: { name: true } },
        academicYear: { select: { name: true } },
        site: { select: { name: true } },
      },
    })

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      gradeLevelId: updated.gradeLevelId,
      gradeLevelName: updated.gradeLevel.name,
      academicYearId: updated.academicYearId,
      academicYearName: updated.academicYear.name,
      siteId: updated.siteId,
      siteName: updated.site.name,
      name: updated.name,
      capacity: updated.capacity,
      headTeacherName: updated.headTeacherName,
    }
  }
}
