import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MESSAGING_SETTINGS,
  readMessagingSettings,
  TenantMessagingSettingsInputSchema,
} from './messaging-settings.js'
import {
  DEFAULT_MORATORIUM_POLICY,
  MAX_MORATORIUM_DAYS,
  MoratoriumPolicyInputSchema,
  RefuseMoratoriumInputSchema,
  MoratoriumRequestInputSchema,
  readMoratoriumPolicy,
} from './moratorium.js'

/**
 * The point of these: the settings column is plain JSON, nothing at the
 * database level constrains its shape, and the reader runs at 02:00 inside a
 * job that fans out to hundreds of families. It must never throw, and it
 * must never quietly widen a limit.
 */

describe('reading the moratoire policy', () => {
  it('falls back to every default for a tenant that has configured nothing', () => {
    expect(readMoratoriumPolicy({})).toEqual(DEFAULT_MORATORIUM_POLICY)
  })

  it('is off by default — a school opts in', () => {
    expect(readMoratoriumPolicy({}).enabled).toBe(false)
  })

  it.each([null, undefined, 'nonsense', 42, []])('survives a settings blob that is %s', (settings) => {
    expect(() => readMoratoriumPolicy(settings)).not.toThrow()
    expect(readMoratoriumPolicy(settings)).toEqual(DEFAULT_MORATORIUM_POLICY)
  })

  it('reads what a school actually set', () => {
    const policy = readMoratoriumPolicy({
      moratorium: { enabled: true, approval: 'auto', lateGraceDays: 0, refusalFreesSlot: false },
    })

    expect(policy.enabled).toBe(true)
    expect(policy.approval).toBe('auto')
    expect(policy.lateGraceDays).toBe(0)
    expect(policy.refusalFreesSlot).toBe(false)
  })

  /**
   * The whole reason for parsing field by field. A blanket parse would drop
   * `enabled: true` along with the bad duration, silently switching the
   * feature off for a school that had switched it on.
   */
  it('costs one default per bad field, not all of them', () => {
    const policy = readMoratoriumPolicy({
      moratorium: { enabled: true, approval: 'auto', allowedDurationsDays: [7, 30] },
    })

    expect(policy.enabled).toBe(true)
    expect(policy.approval).toBe('auto')
    expect(policy.allowedDurationsDays).toEqual(DEFAULT_MORATORIUM_POLICY.allowedDurationsDays)
  })

  it('cannot be configured past three weeks, even by hand-editing the blob', () => {
    const policy = readMoratoriumPolicy({ moratorium: { allowedDurationsDays: [MAX_MORATORIUM_DAYS + 1] } })
    expect(Math.max(...policy.allowedDurationsDays)).toBeLessThanOrEqual(MAX_MORATORIUM_DAYS)
  })

  it('sorts and de-duplicates the durations, whatever the school typed', () => {
    const policy = readMoratoriumPolicy({ moratorium: { allowedDurationsDays: [21, 7, 7, 14] } })
    expect(policy.allowedDurationsDays).toEqual([7, 14, 21])
  })

  it('lets a school offer LESS than three weeks', () => {
    const policy = readMoratoriumPolicy({ moratorium: { allowedDurationsDays: [7] } })
    expect(policy.allowedDurationsDays).toEqual([7])
  })
})

describe('writing the moratoire policy', () => {
  /**
   * The strict/lenient split. A director asking for a month must be told the
   * cap, not silently given three weeks — the read path forgives an old blob,
   * the write path never forgives a person.
   */
  it('rejects a duration past the cap rather than clamping it', () => {
    const result = MoratoriumPolicyInputSchema.safeParse({
      ...DEFAULT_MORATORIUM_POLICY,
      allowedDurationsDays: [30],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty duration list — there would be no button to press', () => {
    const result = MoratoriumPolicyInputSchema.safeParse({
      ...DEFAULT_MORATORIUM_POLICY,
      allowedDurationsDays: [],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a complete, valid policy', () => {
    expect(MoratoriumPolicyInputSchema.safeParse(DEFAULT_MORATORIUM_POLICY).success).toBe(true)
  })

  it('requires every field, so a partial PATCH cannot half-configure a school', () => {
    expect(MoratoriumPolicyInputSchema.safeParse({ enabled: true }).success).toBe(false)
  })
})

describe('the parent-facing request', () => {
  it('rejects a duration past the cap', () => {
    const input = { durationDays: 28, idempotencyKey: '11111111-1111-1111-1111-111111111111' }
    expect(MoratoriumRequestInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejects a zero or negative duration', () => {
    const key = '11111111-1111-1111-1111-111111111111'
    expect(MoratoriumRequestInputSchema.safeParse({ durationDays: 0, idempotencyKey: key }).success).toBe(false)
    expect(MoratoriumRequestInputSchema.safeParse({ durationDays: -7, idempotencyKey: key }).success).toBe(false)
  })

  it('requires an idempotency key, because a 2G double-tap is the normal case', () => {
    expect(MoratoriumRequestInputSchema.safeParse({ durationDays: 14 }).success).toBe(false)
  })

  it('caps the parent reason, so a paste cannot fill the column', () => {
    const input = {
      durationDays: 14,
      reason: 'a'.repeat(281),
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
    }
    expect(MoratoriumRequestInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('refusing a moratoire', () => {
  /** Same rule as a cash variance: no closing it without a written reason. */
  it('requires a note', () => {
    expect(RefuseMoratoriumInputSchema.safeParse({}).success).toBe(false)
    expect(RefuseMoratoriumInputSchema.safeParse({ note: '' }).success).toBe(false)
    expect(RefuseMoratoriumInputSchema.safeParse({ note: 'Déjà deux reports cette année.' }).success).toBe(true)
  })
})

describe('reading the messaging settings', () => {
  it('falls back to every default for a tenant that has configured nothing', () => {
    expect(readMessagingSettings({})).toEqual(DEFAULT_MESSAGING_SETTINGS)
  })

  it.each([null, undefined, 'nonsense', 42])('survives a settings blob that is %s', (settings) => {
    expect(() => readMessagingSettings(settings)).not.toThrow()
  })

  it('costs one default per bad field, not all of them', () => {
    const settings = readMessagingSettings({
      messaging: { sendHour: 8, guardianDailyCap: 999, quietHours: { startHour: 6, endHour: 21 } },
    })

    expect(settings.sendHour).toBe(8)
    expect(settings.quietHours).toEqual({ startHour: 6, endHour: 21 })
    expect(settings.guardianDailyCap).toBe(DEFAULT_MESSAGING_SETTINGS.guardianDailyCap)
  })

  it('rejects a half-written quiet-hours object rather than inventing an hour', () => {
    const settings = readMessagingSettings({ messaging: { quietHours: { startHour: 7 } } })
    expect(settings.quietHours).toEqual(DEFAULT_MESSAGING_SETTINGS.quietHours)
  })

  it('rejects an out-of-range send hour on the write path', () => {
    const result = TenantMessagingSettingsInputSchema.safeParse({ ...DEFAULT_MESSAGING_SETTINGS, sendHour: 24 })
    expect(result.success).toBe(false)
  })

  /**
   * The tenant cap is the anti-reminder-storm limit. A school that sets it
   * to zero would silently stop every reminder, which reads as "the product
   * is broken" rather than "I typed 0".
   */
  it('refuses a tenant daily cap of zero', () => {
    const result = TenantMessagingSettingsInputSchema.safeParse({ ...DEFAULT_MESSAGING_SETTINGS, tenantDailyCap: 0 })
    expect(result.success).toBe(false)
  })
})
