import { SetMetadata } from '@nestjs/common'

/**
 * Mark a route as reachable by a school whose subscription has lapsed.
 *
 * The SubscriptionGuard blocks everything else, so this decorator is what
 * keeps a lapsed school able to pay: without it the renewal endpoint would be
 * behind the very lock that renewing removes, and a school that let its
 * subscription run out could never buy its way back in.
 *
 * Apply it ONLY to billing and account endpoints. Every use is a hole in the
 * lock, so each one should be obvious from the route's name.
 */
export const ALLOWS_LAPSED_KEY = 'allowsLapsed'
export const AllowsLapsed = () => SetMetadata(ALLOWS_LAPSED_KEY, true)
