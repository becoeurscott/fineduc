import { SetMetadata } from '@nestjs/common'

/**
 * Mark a route as public — the AuthGuard will skip JWT verification.
 * Used for login, refresh, payment links, webhooks, and health checks.
 */
export const IS_PUBLIC_KEY = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
