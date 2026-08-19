'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

/**
 * Counts a formatted price up to its value — the template runs a
 * NumberFlow component on exactly these figures.
 *
 * Renders the FINAL string on the server and only animates after mount, so
 * the real price is in the HTML for a reader without JavaScript and for a
 * crawler. Two triggers, both of which the template has: once when the
 * figure first scrolls into view, and again whenever the value changes —
 * which here is the monthly/annual toggle, the moment the motion is
 * actually worth something.
 *
 * Prices arrive as display strings ('25 000'), so the group separator is
 * read back off the source rather than assumed: fr-FR and en-GB disagree,
 * and hardcoding either would corrupt one locale.
 */
const DURATION = 700

function digitsOf(value: string) {
  return Number(value.replace(/\D/g, ''))
}

function separatorOf(sample: string) {
  return sample.match(/\d(\D)\d/)?.[1] ?? ''
}

function formatLike(n: number, sample: string) {
  const sep = separatorOf(sample)
  if (!sep) return String(n)
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

// Decelerating, so the number lands softly instead of stopping dead.
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)
  const from = useRef(0)
  const started = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const target = digitsOf(value)
    if (!Number.isFinite(target) || target === 0) {
      setDisplay(value)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }

    let frame = 0
    const run = () => {
      const start = performance.now()
      const origin = from.current
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION)
        const current = Math.round(origin + (target - origin) * easeOutCubic(t))
        setDisplay(formatLike(current, value))
        if (t < 1) frame = requestAnimationFrame(tick)
        else from.current = target
      }
      frame = requestAnimationFrame(tick)
    }

    // First run waits for the figure to be on screen; later runs are the
    // toggle, which is already on screen by definition.
    if (started.current) {
      run()
      return () => cancelAnimationFrame(frame)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          started.current = true
          observer.disconnect()
          run()
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  // tabular-nums stops the figure reflowing its neighbours while it counts.
  return (
    <span ref={ref} className={clsx('tabular-nums', className)}>
      {display}
    </span>
  )
}
