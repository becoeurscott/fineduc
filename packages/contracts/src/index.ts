/**
 * @fineduc/contracts — the single source of truth for the API surface.
 *
 * Zod schemas generate the runtime validation, the TypeScript types, AND
 * the OpenAPI document (ARCHITECTURE.md §2). Never hand-write a type that
 * parallels a schema here: derive it with `z.infer`.
 */
export * from './common.js'
export * from './money.js'
export * from './auth.js'
export * from './user.js'
export * from './tenant.js'
export * from './pagination.js'
export * from './dashboard.js'
export * from './students.js'
export * from './payments.js'
export * from './fees.js'
export * from './invoices.js'
export * from './reminders.js'
export * from './admin.js'
export * from './permissions.js'
export * from './academics.js'
