import clsx from 'clsx'

/**
 * The template's "Integrations" ring, measured: a 940px circle whose items
 * sit on the rim at 22.5° steps, inside a 1000×505 box with `overflow:
 * clip` — so only the TOP HALF of the circle is ever on screen. The arc is
 * the whole point; a full visible circle reads as a logo cloud instead.
 *
 * Two counter-rotating animations rather than one: the ring turns, and each
 * tile turns back by the same amount, so a tile orbits without ever tipping
 * over. Doing it with a single rotation would leave the labels upside down
 * at the far end of the arc.
 *
 * Tiles are PLACEHOLDERS, dashed and labelled, exactly like the trusted-by
 * row. The labels name things the product genuinely does — no logo goes in
 * here until it is cleared, because an integrations wall reads as a claim
 * of partnership.
 *
 * The arc is a DESKTOP composition and is dropped below `sm`. A 124px text
 * tile needs ~±105px of horizontal room on a 335px phone box, which caps
 * the usable arc at ±41° — at that point two of the eight tiles are off
 * screen entirely and the shape stops reading as a circle. A plain grid
 * says the same thing without pretending.
 */
const COUNT = 8

/**
 * −62° to +62°, not the template's full half-turn. The template's rim items
 * are ~60px bubbles that still clear the box at ±90°; ours are 150px text
 * pills, which at ±90° would sit half-outside the clip and read as broken
 * the moment the animation is paused (or switched off for reduced motion).
 * 62° is the widest angle that keeps a 150px pill inside a 1000px box on a
 * 470px radius. The spin still carries tiles out through the sides — that
 * is the orbit, and it only looks deliberate if the resting state is clean.
 */
const SPREAD = 124

function angleFor(index: number) {
  return (index * SPREAD) / (COUNT - 1) - SPREAD / 2
}

export function OrbitRing({
  items,
  footnote,
  className,
}: {
  items: readonly string[]
  footnote: string
  className?: string
}) {
  const tiles = items.slice(0, COUNT)

  return (
    <div className={clsx('mx-auto w-full max-w-[1000px]', className)}>
      {/* Phones: the same tiles, no geometry. */}
      <ul className="grid grid-cols-2 gap-2.5 sm:hidden">
        {tiles.map((label) => (
          <li
            key={label}
            className="flex h-11 items-center justify-center rounded-[14px] border border-dashed border-line bg-[#edf1f4] px-3 text-center text-[11px] font-medium text-slate"
          >
            {label}
          </li>
        ))}
      </ul>

      {/* The clip box. Height is half the ring plus a little, so the arc is
          cut by the box rather than fading out mid-air. */}
      <div className="relative hidden h-[330px] overflow-clip [--orbit:760px] sm:block lg:h-[505px] lg:[--orbit:940px]">
        <div
          // Pushed down by half a tile: with the ring flush to the top of
          // the box, the tiles riding the apex are sliced in half by it.
          className="absolute top-[28px] left-1/2 h-[var(--orbit)] w-[var(--orbit)] -translate-x-1/2 motion-safe:animate-[orbit_60s_linear_infinite]"
          aria-hidden="true"
        >
          {tiles.map((label, i) => {
            const angle = angleFor(i)
            return (
              <div
                key={label}
                className="absolute top-1/2 left-1/2"
                style={{
                  // Out to the rim at `angle`, then straight again so the
                  // tile is upright before the ring's own spin is applied.
                  transform: `rotate(${angle}deg) translateY(calc(var(--orbit) / -2)) rotate(${-angle}deg)`,
                }}
              >
                <div className="-translate-x-1/2 -translate-y-1/2 motion-safe:animate-[orbit_60s_linear_infinite_reverse]">
                  <span className="flex h-14 w-[150px] items-center justify-center rounded-[14px] border border-dashed border-line bg-[#edf1f4] px-3 text-center text-[12px] font-medium text-slate">
                    {label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* The arc above is aria-hidden, so from `sm` up this is what a screen
          reader actually reads. Hidden on phones, where the visible grid is
          already a real list. */}
      <ul className="sr-only hidden sm:block">
        {tiles.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>

      <p className="mt-6 text-center text-[13px] text-slate-muted">{footnote}</p>
    </div>
  )
}
