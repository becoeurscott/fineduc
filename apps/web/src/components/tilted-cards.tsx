import clsx from 'clsx'

/**
 * The template's fanned pair, measured off its Features section: two cards
 * overlapping, 20px radius, one rotated −5° and the other +12°. The uneven
 * angles are the trick — mirroring them (−5/+5) reads as a symmetrical
 * logo, not as two things dropped on a desk.
 *
 * Sizes are the template's from `sm` up: 250×233 behind, 300×276 in front.
 * Phones get a smaller pair, because rotation grows the footprint — a −5°
 * turn on a 250px card claims 269px of width — and the template's sizes
 * would push the fan past both edges of a 335px column.
 *
 * These hold PLACEHOLDERS. They are where product screenshots go, and an
 * empty dashed card that says so is honest; a stock photo of somebody
 * else's dashboard would not be.
 */
export function TiltedCards({ labels, className }: { labels: readonly string[]; className?: string }) {
  const [back, front] = [labels[0] ?? '', labels[1] ?? labels[0] ?? '']

  return (
    <div className={clsx('relative mx-auto h-[260px] w-full max-w-[420px] sm:h-[320px]', className)} aria-hidden="true">
      <Card
        label={back}
        className="absolute top-2 left-1 h-[155px] w-[168px] -rotate-[5deg] sm:h-[233px] sm:w-[250px]"
      />
      <Card
        label={front}
        className="absolute right-1 bottom-2 h-[178px] w-[195px] rotate-[12deg] sm:h-[276px] sm:w-[300px]"
      />
    </div>
  )
}

function Card({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={clsx(
        'grid place-items-center rounded-[20px] border border-dashed border-line bg-[#edf1f4] p-4 text-center',
        className,
      )}
    >
      <span className="text-[12px] font-medium text-slate">{label}</span>
    </div>
  )
}
