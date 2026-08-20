import { describe, it, expect } from 'vitest'
import { encodePaymentReference, decodePaymentReference } from './payment-reference.js'

const TENANT = '11111111-2222-3333-4444-555555555555'
const PAYMENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('encodePaymentReference', () => {
  it('carries the tenant and the payment', () => {
    expect(encodePaymentReference({ tenantId: TENANT, paymentId: PAYMENT })).toBe(`fd:${TENANT}:${PAYMENT}`)
  })

  it('rejects anything that is not a uuid, rather than minting a reference nobody can resolve', () => {
    expect(() => encodePaymentReference({ tenantId: 'nope', paymentId: PAYMENT })).toThrow(/Not a tenant id/)
    expect(() => encodePaymentReference({ tenantId: TENANT, paymentId: '' })).toThrow(/Not a payment id/)
  })
})

describe('decodePaymentReference', () => {
  it('round-trips', () => {
    const encoded = encodePaymentReference({ tenantId: TENANT, paymentId: PAYMENT })
    expect(decodePaymentReference(encoded)).toEqual({ tenantId: TENANT, paymentId: PAYMENT })
  })

  it('is case-insensitive about the uuids, as aggregators are not careful', () => {
    expect(decodePaymentReference(`fd:${TENANT.toUpperCase()}:${PAYMENT.toUpperCase()}`)).toEqual({
      tenantId: TENANT.toUpperCase(),
      paymentId: PAYMENT.toUpperCase(),
    })
  })

  /**
   * A webhook can legitimately carry a reference we did not mint — a test
   * callback from the aggregator's dashboard, or another system on the same
   * account. Returning null lets the worker fail loudly instead of settling
   * against a guessed tenant.
   */
  describe('returns null for anything not ours', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty', ''],
      ['no prefix', `${TENANT}:${PAYMENT}`],
      ['wrong prefix', `xx:${TENANT}:${PAYMENT}`],
      ['too few parts', `fd:${TENANT}`],
      ['too many parts', `fd:${TENANT}:${PAYMENT}:extra`],
      ['tenant not a uuid', `fd:not-a-uuid:${PAYMENT}`],
      ['payment not a uuid', `fd:${TENANT}:not-a-uuid`],
      ["an aggregator's own reference", 'CINETPAY_TXN_12345'],
    ])('%s', (_label, input) => {
      expect(decodePaymentReference(input)).toBeNull()
    })
  })

  /**
   * THE regression. The webhook job originally carried `tenantId: ''`, which
   * `withTenant` rejects as a non-uuid — so no webhook could ever have
   * settled. The tenant now comes from here, and an unresolvable reference
   * must be reported as such rather than yielding a blank that fails deep
   * inside a transaction.
   */
  it('never yields a blank tenant', () => {
    for (const bad of ['', 'fd::', `fd::${PAYMENT}`, `fd:${TENANT}:`]) {
      const decoded = decodePaymentReference(bad)
      expect(decoded).toBeNull()
    }
  })
})
