/**
 * Resolves the connection string the API/worker actually connect with —
 * the least-privilege `fineduc_app` role (ARCHITECTURE.md §4, §10), never
 * the migrator/owner role that `prisma migrate` uses.
 *
 * `explicitAppUrl` is `env.APP_DATABASE_URL` — required in production
 * (packages/config/src/env.ts enforces this) and set to a password the
 * migration file never sees. When it is absent (development/test), this
 * derives the role's connection string from the owner URL using the
 * well-known dev password the RLS migration creates the role with — see
 * `packages/db/prisma/migrations/*_row_level_security_and_invariants/migration.sql`.
 */
const DEV_APP_ROLE_USERNAME = 'fineduc_app'
const DEV_APP_ROLE_PASSWORD = 'fineduc_app_dev_only'

export function resolveAppDatabaseUrl(ownerDatabaseUrl: string, explicitAppUrl?: string): string {
  if (explicitAppUrl) return explicitAppUrl

  const url = new URL(ownerDatabaseUrl)
  url.username = DEV_APP_ROLE_USERNAME
  url.password = DEV_APP_ROLE_PASSWORD
  return url.toString()
}
