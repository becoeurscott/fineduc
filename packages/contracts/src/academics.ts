import { z } from 'zod'
import { CalendarDateSchema, UuidSchema } from './common.js'

export const AcademicYearStatusSchema = z.enum(['draft', 'active', 'closed'])
export type AcademicYearStatus = z.infer<typeof AcademicYearStatusSchema>

export const AcademicYearSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  name: z.string(),
  startsOn: CalendarDateSchema,
  endsOn: CalendarDateSchema,
  status: AcademicYearStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type AcademicYear = z.infer<typeof AcademicYearSchema>

export const CreateAcademicYearRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  startsOn: CalendarDateSchema,
  endsOn: CalendarDateSchema,
})
export type CreateAcademicYearRequest = z.infer<typeof CreateAcademicYearRequestSchema>

export const UpdateAcademicYearRequestSchema = z.object({
  name: z.string().min(1).optional(),
  startsOn: CalendarDateSchema.optional(),
  endsOn: CalendarDateSchema.optional(),
})
export type UpdateAcademicYearRequest = z.infer<typeof UpdateAcademicYearRequestSchema>

export const TermSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  academicYearId: UuidSchema,
  name: z.string(),
  startsOn: CalendarDateSchema,
  endsOn: CalendarDateSchema,
  sequence: z.number().int().positive(),
})
export type Term = z.infer<typeof TermSchema>

export const CreateTermRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  startsOn: CalendarDateSchema,
  endsOn: CalendarDateSchema,
  sequence: z.number().int().positive(),
})
export type CreateTermRequest = z.infer<typeof CreateTermRequestSchema>

export const GradeLevelSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  name: z.string(),
  sequence: z.number().int().positive(),
  cycle: z.string().nullable().optional(),
})
export type GradeLevel = z.infer<typeof GradeLevelSchema>

export const CreateGradeLevelRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  sequence: z.number().int().positive(),
  cycle: z.string().optional(),
})
export type CreateGradeLevelRequest = z.infer<typeof CreateGradeLevelRequestSchema>

export const UpdateGradeLevelRequestSchema = z.object({
  name: z.string().min(1).optional(),
  sequence: z.number().int().positive().optional(),
  cycle: z.string().nullable().optional(),
})
export type UpdateGradeLevelRequest = z.infer<typeof UpdateGradeLevelRequestSchema>

export const ClassGroupSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  gradeLevelId: UuidSchema,
  gradeLevelName: z.string().optional(),
  academicYearId: UuidSchema,
  academicYearName: z.string().optional(),
  siteId: UuidSchema,
  siteName: z.string().optional(),
  name: z.string(),
  capacity: z.number().int().positive().nullable().optional(),
  headTeacherName: z.string().nullable().optional(),
})
export type ClassGroup = z.infer<typeof ClassGroupSchema>

export const CreateClassGroupRequestSchema = z.object({
  gradeLevelId: UuidSchema,
  academicYearId: UuidSchema,
  siteId: UuidSchema,
  name: z.string().min(1, 'Name is required'),
  capacity: z.number().int().positive().optional(),
  headTeacherName: z.string().optional(),
})
export type CreateClassGroupRequest = z.infer<typeof CreateClassGroupRequestSchema>

export const UpdateClassGroupRequestSchema = z.object({
  name: z.string().min(1).optional(),
  capacity: z.number().int().positive().nullable().optional(),
  headTeacherName: z.string().nullable().optional(),
})
export type UpdateClassGroupRequest = z.infer<typeof UpdateClassGroupRequestSchema>
