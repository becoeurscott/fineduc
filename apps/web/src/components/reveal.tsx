'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

/**
 * Scroll-triggered reveal, matching the FintechX template's feel (PRD §8).
 *
 * Hand-rolled on IntersectionObserver rather than pulling in an animation
 * library: this site is static marketing served to a three-year-old Android
 * over 3G, and ~40 kB of JS for a fade-and-rise is not a trade worth making.
 *
 * Starts VISIBLE and only hides once the observer is attached, so the
 * content is readable with JavaScript disabled or still downloading —
 * a fade-in library that ships `opacity: 0` in the HTML leaves a blank page
 * on a slow connection.
 *
 * `distance` reproduces the template's tiered rise. It does not use one
 * offset everywhere: small rows travel 10px, ordinary blocks 20px, and the
 * one big showcase panel 50px. Reading the page, that reads as weight —
 * the larger the thing, the further it has come.
 */
const DISTANCE = {
  sm: 'translate-y-[10px]',
  md: 'translate-y-[20px]',
  lg: 'translate-y-[50px]',
} as const

export type RevealDistance = keyof typeof DISTANCE
export function Reveal({
  children,
  delay = 0,
  distance = 'md',
  className,
}: {
  children: React.ReactNode
  delay?: number
  distance?: RevealDistance
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'static' | 'hidden' | 'shown'>('static')

  useEffect(() => {
    const node = ref.current
    if (!node) return

    // Respect the OS setting — no animation at all rather than a faster one.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setState('shown')
      return
    }

    setState('hidden')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setState('shown')
            observer.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={state === 'hidden' ? undefined : { transitionDelay: `${delay}ms` }}
      className={clsx(
        'transition-all duration-700 ease-out motion-reduce:transition-none',
        state === 'hidden' ? `${DISTANCE[distance]} opacity-0` : 'translate-y-0 opacity-100',
        className,
      )}
    >
      {children}
    </div>
  )
}
