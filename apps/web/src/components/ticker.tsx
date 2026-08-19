import clsx from 'clsx'

/**
 * Infinite right-to-left ticker — the template's "Trusted by" logo row
 * and its testimonial strip both use this motion.
 *
 * Pure CSS: the track holds the items TWICE and a keyframe translates it
 * by exactly -50%, so the loop point is invisible. No JS, no layout
 * thrash, pauses on hover (so a reader can actually read a testimonial),
 * and honours prefers-reduced-motion by simply not moving.
 */
export function Ticker({
  children,
  speedSeconds = 40,
  className,
  gap = 'gap-4',
}: {
  children: React.ReactNode
  speedSeconds?: number
  className?: string
  gap?: string
}) {
  return (
    <div
      className={clsx(
        'group relative overflow-hidden',
        // soft fade at both edges, like the template's
        '[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]',
        className,
      )}
    >
      <div
        className={clsx('flex w-max motion-safe:animate-[ticker_linear_infinite] group-hover:[animation-play-state:paused]', gap)}
        style={{ animationDuration: `${speedSeconds}s` }}
      >
        <div className={clsx('flex shrink-0', gap)}>{children}</div>
        <div className={clsx('flex shrink-0', gap)} aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  )
}
