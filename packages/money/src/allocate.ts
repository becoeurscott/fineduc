/**
 * Splitting money without losing or inventing a minor unit.
 *
 * Every split in this file uses the largest-remainder method: compute each
 * share's integer floor, then hand the leftover minor units, one each, to
 * the shares with the largest fractional remainder (ties broken by
 * position, left to right — deterministic, so the same inputs always
 * produce the same split).
 *
 * ARCHITECTURE.md §5: "100 000 XAF split three ways is 33 334 / 33 333 /
 * 33 333 — never 33 333.33."
 */
import { Money } from './money.js'

/**
 * Split `total` proportionally to `weights`. The parts always re-sum to
 * exactly `total` — that is the entire point of this function.
 */
export function allocate(total: Money, weights: readonly (number | bigint)[]): Money[] {
  if (weights.length === 0) {
    throw new RangeError('allocate() requires at least one weight')
  }

  const w = weights.map(toWeight)
  if (w.some((x) => x < 0n)) {
    throw new RangeError('allocate() weights must be non-negative')
  }
  const totalWeight = w.reduce((a, b) => a + b, 0n)
  if (totalWeight <= 0n) {
    throw new RangeError('allocate() weights must sum to more than zero')
  }

  const negative = total.amount < 0n
  const absAmount = negative ? -total.amount : total.amount

  const shares = w.map((x) => (absAmount * x) / totalWeight)
  const remainders = w.map((x) => (absAmount * x) % totalWeight)
  const distributed = shares.reduce((a, b) => a + b, 0n)
  let leftover = absAmount - distributed

  const order = w
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = remainders[a] as bigint
      const rb = remainders[b] as bigint
      if (ra !== rb) return ra > rb ? -1 : 1
      return a - b
    })

  const result = shares.slice()
  for (const index of order) {
    if (leftover <= 0n) break
    result[index] = (result[index] as bigint) + 1n
    leftover -= 1n
  }

  return result.map((amount) => Money.of(negative ? -amount : amount, total.currency))
}

/** Convenience: split `total` into `parts` equal-weight shares. */
export function allocateEven(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError('allocateEven() requires a positive integer part count')
  }
  return allocate(
    total,
    Array.from({ length: parts }, () => 1),
  )
}

/**
 * A percentage discount/fee, expressed in basis points of 100% (10 000 bp =
 * 100%, 1 000 bp = 10%), rounded HALF-UP to the nearest minor unit.
 * `base` must be non-negative — this is a magnitude calculation, not a
 * signed ledger entry; the caller decides the sign.
 */
export function percentOfBp(base: Money, basisPoints: number | bigint): Money {
  if (base.amount < 0n) {
    throw new RangeError('percentOfBp() requires a non-negative base amount')
  }
  const bp = typeof basisPoints === 'bigint' ? basisPoints : BigInt(Math.trunc(basisPoints))
  if (bp < 0n) {
    throw new RangeError('percentOfBp() requires non-negative basis points')
  }
  const numerator = base.amount * bp + 5_000n
  const result = numerator / 10_000n
  return Money.of(result, base.currency)
}

function toWeight(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isInteger(value)) {
    throw new RangeError(`allocate() weights must be integers, got: ${value}`)
  }
  return BigInt(value)
}
