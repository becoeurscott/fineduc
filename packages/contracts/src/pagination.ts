/**
 * Cursor pagination (ARCHITECTURE.md §12: "Cursor pagination, cursor&limit,
 * max 100"). Used by every list endpoint.
 */
import { z } from 'zod'

export const CursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type CursorPagination = z.infer<typeof CursorPaginationSchema>

/**
 * Build a paginated response envelope. The generic `data` array carries the
 * page items; `nextCursor` is the opaque token for the next page (absent on
 * the last page); `hasMore` is a convenience boolean.
 */
export interface PaginatedResponse<T> {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
}
