'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

/**
 * The template's "Comparison" block, layer by layer as measured:
 *
 *   - ONE dark card, 700px wide on desktop, 20px radius
 *   - a pill toggle at the top: "Before FintechX" | "After FintechX"
 *   - a 1px white hairline under the toggle
 *   - body in two columns: a bulleted pain/gain list on the left, and on
 *     the right TWO stat tiles (20px radius, 20px padding) — red-tinted
 *     `rgba(255,13,13,0.05)` in the Before state
 *   - switching states cross-fades the whole body
 *
 * Both states are in the HTML at all times (one hidden), so the full
 * copy is indexable and readable without JavaScript.
 *
 * The switch is driven by SCROLL, not by the reader: the card flips to
 * "after" as it rises through the viewport, so the argument makes itself
 * to someone who never touches the control. The tabs stay real buttons
 * for keyboard and screen-reader users — but the first deliberate click
 * hands control over for good, because a toggle that fights the pointer
 * is worse than one that never moved.
 */

/**
 * Hysteresis: flip to "after" once the card's top passes 35% of the
 * viewport, back to "before" only below 50%. Without the gap, a card
 * parked near the threshold strobes on every scroll tick.
 */
const FLIP_TO_AFTER = 0.35
const FLIP_TO_BEFORE = 0.5
type Stat = { readonly value: string; readonly label: string }
type Item = { readonly title: string; readonly body: string }

export function BeforeAfter({
  beforeLabel,
  afterLabel,
  before,
  after,
  beforeStats,
  afterStats,
}: {
  beforeLabel: string
  afterLabel: string
  before: readonly Item[]
  after: readonly Item[]
  beforeStats: readonly Stat[]
  afterStats: readonly Stat[]
}) {
  const [showAfter, setShowAfter] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  // Set on the first real click; scroll never touches the state again.
  const takenOver = useRef(false)

  useEffect(() => {
    const node = cardRef.current
    if (!node) return

    let frame = 0
    const read = () => {
      frame = 0
      if (takenOver.current) return
      const top = node.getBoundingClientRect().top / window.innerHeight
      setShowAfter((current) => (current ? top <= FLIP_TO_BEFORE : top < FLIP_TO_AFTER))
    }
    const onScroll = () => {
      // Coalesce to one read per frame — scroll fires far faster than paint.
      if (!frame) frame = requestAnimationFrame(read)
    }

    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div
      ref={cardRef}
      className="mx-auto w-full max-w-[760px] rounded-[20px] bg-[#1d1d1d] p-5 text-left text-white sm:p-8"
    >
      {/* toggle */}
      <div
        role="tablist"
        aria-label={`${beforeLabel} / ${afterLabel}`}
        className="mx-auto flex w-full max-w-md items-center gap-1 rounded-[100px] bg-white/10 p-1.5"
      >
        {[
          { key: false, label: beforeLabel },
          { key: true, label: afterLabel },
        ].map((tab) => (
          <button
            key={String(tab.key)}
            role="tab"
            aria-selected={showAfter === tab.key}
            onClick={() => {
              takenOver.current = true
              setShowAfter(tab.key)
            }}
            className={clsx(
              'h-11 flex-1 rounded-[100px] text-[15px] font-medium transition-all duration-300',
              showAfter === tab.key ? 'bg-white text-ink shadow-sm' : 'text-white/70 hover:text-white',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* white hairline, measured */}
      <div aria-hidden="true" className="mx-auto my-7 h-px w-full max-w-[500px] bg-white/60" />

      {/* body — both states stacked, the active one visible */}
      <div className="relative">
        {[
          { key: 'before', items: before, stats: beforeStats, active: !showAfter },
          { key: 'after', items: after, stats: afterStats, active: showAfter },
        ].map((state) => (
          <div
            key={state.key}
            aria-hidden={!state.active}
            className={clsx(
              'grid gap-6 transition-all duration-500 ease-out lg:grid-cols-[1fr_auto] lg:gap-8',
              state.active
                ? 'relative translate-y-0 opacity-100'
                : 'pointer-events-none absolute inset-0 translate-y-2 opacity-0',
            )}
          >
            <ul className="space-y-4">
              {state.items.map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'mt-1 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                      state.key === 'after' ? 'bg-positive text-white' : 'bg-[#f51c23]/20 text-[#ff8b8b]',
                    )}
                  >
                    {state.key === 'after' ? '✓' : '✕'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[18px] leading-snug font-medium text-white">{item.title}</p>
                    <p className="mt-1 text-[15px] leading-[1.6] text-white/60">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-2 gap-3 self-start lg:w-[232px] lg:grid-cols-1">
              {state.stats.map((stat) => (
                <div
                  key={stat.label}
                  className={clsx(
                    'rounded-[20px] p-5',
                    state.key === 'after' ? 'bg-[#10b981]/12' : 'bg-[#ff0d0d]/[0.08]',
                  )}
                >
                  <p
                    className={clsx(
                      'text-[34px] leading-none font-semibold tracking-[-1px]',
                      state.key === 'after' ? 'text-[#6ee7b7]' : 'text-[#ff8b8b]',
                    )}
                  >
                    {stat.value}
                  </p>
                  <p className="mt-2 text-[14px] leading-snug text-white/65">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
