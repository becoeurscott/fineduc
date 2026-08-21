/**
 * What a message costs, before it is sent.
 *
 * Shared by every adapter because the arithmetic is the same everywhere and
 * only the unit prices differ. Prices are per PRD.md: WhatsApp 10 XAF flat,
 * SMS 30 XAF **per segment** — an SMS is not one price, and treating it as
 * one under-debits the wallet on exactly the messages this product sends
 * most (see `smsSegments`: `reçu` forces UCS-2 and halves the segment size).
 */
import { smsSegments } from '@fineduc/domain'
import { Money, type CurrencyCode } from '@fineduc/money'
import type { Channel } from './port.js'

export interface UnitCosts {
  readonly currency: CurrencyCode
  readonly whatsappMinor: bigint
  readonly smsPerSegmentMinor: bigint
}

export const DEFAULT_UNIT_COSTS: UnitCosts = {
  currency: 'XAF',
  whatsappMinor: 10n,
  smsPerSegmentMinor: 30n,
}

export function priceMessage(body: string, channel: Channel, costs: UnitCosts): Money {
  if (channel === 'whatsapp') {
    return Money.of(costs.whatsappMinor, costs.currency)
  }

  // A body is never empty by the time it is priced — send() rejects that —
  // but charging zero for something we hand to a carrier would be wrong even
  // once, so the floor is one segment.
  const { segments } = smsSegments(body)
  return Money.of(costs.smsPerSegmentMinor * BigInt(Math.max(segments, 1)), costs.currency)
}
