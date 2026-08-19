import { describe, expect, it } from 'vitest'
import { resolveAppDatabaseUrl } from './connection.js'

describe('resolveAppDatabaseUrl', () => {
  it('returns the explicit URL unchanged when given one (production path)', () => {
    const explicit = 'postgresql://fineduc_app:real-secret@db.internal:5432/fineduc'
    expect(resolveAppDatabaseUrl('postgresql://owner:pw@localhost:5432/fineduc', explicit)).toBe(explicit)
  })

  it('derives the dev app-role URL from the owner URL when none is given', () => {
    const resolved = resolveAppDatabaseUrl('postgresql://fineduc:fineduc@localhost:5432/fineduc')
    const parsed = new URL(resolved)
    expect(parsed.username).toBe('fineduc_app')
    expect(parsed.password).toBe('fineduc_app_dev_only')
    expect(parsed.hostname).toBe('localhost')
    expect(parsed.pathname).toBe('/fineduc')
  })

  it('treats an empty explicit URL the same as none given', () => {
    const resolved = resolveAppDatabaseUrl('postgresql://fineduc:fineduc@localhost:5432/fineduc', '')
    expect(new URL(resolved).username).toBe('fineduc_app')
  })
})
