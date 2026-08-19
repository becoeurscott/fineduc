import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { ConflictError, NotFoundError } from '@fineduc/domain'
import type {
  CreateGuardianRequest,
  UpdateGuardianRequest,
  LinkGuardianRequest,
} from '@fineduc/contracts'

@Injectable()
export class GuardianService {
  /**
   * Add a guardian and link them to a student.
   * If a guardian with the same phone already exists in this school (e.g. parent of sibling),
   * reuse the guardian record and create the link (ARCHITECTURE.md §6 "People").
   */
  async addGuardian(
    tx: TenantTransactionClient,
    tenantId: string,
    studentId: string,
    input: CreateGuardianRequest,
  ): Promise<{ guardianId: string; studentGuardianId: string; isNewGuardian: boolean }> {
    const student = await tx.student.findUnique({ where: { id: studentId } })
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundError('student', studentId)
    }

    // Check if guardian already exists by phone within this tenant
    let guardian = await tx.guardian.findFirst({
      where: { tenantId, phoneE164: input.phoneE164 },
    })

    let isNewGuardian = false
    if (!guardian) {
      guardian = await tx.guardian.create({
        data: {
          tenantId,
          firstName: input.firstName,
          lastName: input.lastName,
          phoneE164: input.phoneE164,
          phoneAltE164: input.phoneAltE164 ?? null,
          email: input.email ?? null,
          relationship: input.relationship,
          preferredChannel: input.preferredChannel ?? 'whatsapp',
          verificationStatus: 'unverified',
        },
      })
      isNewGuardian = true
    }

    // Check if already linked
    const existingLink = await tx.studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
    })

    if (existingLink) {
      throw new ConflictError(
        'GUARDIAN_ALREADY_LINKED',
        'This guardian is already linked to the student',
      )
    }

    // If this guardian is marked primary, un-mark previous primary guardians for this student
    if (input.isPrimary) {
      await tx.studentGuardian.updateMany({
        where: { tenantId, studentId, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    const link = await tx.studentGuardian.create({
      data: {
        tenantId,
        studentId,
        guardianId: guardian.id,
        isPrimary: input.isPrimary ?? false,
        paysFees: input.paysFees ?? true,
        sharePercent: input.sharePercent ?? null,
      },
    })

    return {
      guardianId: guardian.id,
      studentGuardianId: link.id,
      isNewGuardian,
    }
  }

  /**
   * Link an existing guardian to a student.
   */
  async linkExistingGuardian(
    tx: TenantTransactionClient,
    tenantId: string,
    studentId: string,
    input: LinkGuardianRequest,
  ): Promise<{ studentGuardianId: string }> {
    const student = await tx.student.findUnique({ where: { id: studentId } })
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundError('student', studentId)
    }

    const guardian = await tx.guardian.findUnique({ where: { id: input.guardianId } })
    if (!guardian || guardian.tenantId !== tenantId) {
      throw new NotFoundError('guardian', input.guardianId)
    }

    const existingLink = await tx.studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId, guardianId: input.guardianId } },
    })

    if (existingLink) {
      throw new ConflictError(
        'GUARDIAN_ALREADY_LINKED',
        'This guardian is already linked to the student',
      )
    }

    if (input.isPrimary) {
      await tx.studentGuardian.updateMany({
        where: { tenantId, studentId, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    const link = await tx.studentGuardian.create({
      data: {
        tenantId,
        studentId,
        guardianId: input.guardianId,
        isPrimary: input.isPrimary ?? false,
        paysFees: input.paysFees ?? true,
        sharePercent: input.sharePercent ?? null,
      },
    })

    return { studentGuardianId: link.id }
  }

  /**
   * Update guardian details.
   */
  async updateGuardian(
    tx: TenantTransactionClient,
    tenantId: string,
    guardianId: string,
    input: UpdateGuardianRequest,
  ): Promise<void> {
    const guardian = await tx.guardian.findUnique({ where: { id: guardianId } })
    if (!guardian || guardian.tenantId !== tenantId) {
      throw new NotFoundError('guardian', guardianId)
    }

    await tx.guardian.update({
      where: { id: guardianId },
      data: {
        ...(input.firstName ? { firstName: input.firstName } : {}),
        ...(input.lastName ? { lastName: input.lastName } : {}),
        ...(input.phoneE164 ? { phoneE164: input.phoneE164 } : {}),
        ...(input.phoneAltE164 !== undefined ? { phoneAltE164: input.phoneAltE164 } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.relationship ? { relationship: input.relationship } : {}),
        ...(input.preferredChannel ? { preferredChannel: input.preferredChannel } : {}),
        ...(input.whatsappOptIn !== undefined ? { whatsappOptIn: input.whatsappOptIn } : {}),
      },
    })
  }
}
