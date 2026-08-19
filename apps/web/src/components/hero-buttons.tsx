import Link from 'next/link'
import clsx from 'clsx'

/**
 * The template's two hero buttons, reproduced from measurement — not
 * approximated.
 *
 * Primary ("Get started now"): 59px pill, fill is a BLUE GRADIENT
 * `linear-gradient(110deg, #3b82f6 0%, #406ae4 100%)`, white 18px/600
 * text, and a 44px WHITE CIRCLE on the right holding the arrow. On hover
 * the circle nudges right and the arrow rotates from ↗ to →.
 *
 * Secondary ("View demo"): 59px white pill, `overflow: clip`, containing
 * TWO stacked copies of the label ("Default Title" / "Hover Title" in the
 * template). On hover the whole stack translates up by one line, so the
 * visible label slides out the top while its twin slides in from below.
 * That is the effect — text is never faded, it moves.
 */
export function PrimaryButton({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={clsx(
        'group inline-flex h-[59px] items-center gap-3 rounded-[100px] py-1.5 pr-1.5 pl-7 text-[18px] font-semibold text-white transition-[filter,transform] duration-300 hover:brightness-105 active:scale-[0.98]',
        className,
      )}
      style={{ backgroundImage: 'linear-gradient(110deg, #3b82f6 0%, #406ae4 100%)' }}
    >
      <span>{children}</span>
      <span
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-[#3b82f6] transition-transform duration-300 group-hover:translate-x-0.5"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4 transition-transform duration-300 group-hover:rotate-45"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* drawn as ↗ at rest; rotate(45) turns it into → */}
          <path d="M4 12 L12 4" />
          <path d="M6 4 H12 V10" />
        </svg>
      </span>
    </Link>
  )
}

export function SecondaryButton({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={clsx(
        'group inline-flex h-[59px] items-center justify-center overflow-clip rounded-[100px] bg-white px-11 text-[18px] font-semibold text-ink shadow-[0_1px_2px_rgba(29,29,29,0.06)] transition-colors hover:bg-[#f6f8fa]',
        className,
      )}
    >
      {/* One line tall; the stack inside is two lines and slides up by ONE.
          NB: -translate-y-full would be 100% of the 2-line stack (two lines,
          overshooting), so the shift is the window's own height instead. */}
      <span className="relative block h-[1.25em] overflow-clip leading-[1.25em]">
        <span className="block transition-transform duration-300 ease-out group-hover:-translate-y-[1.25em]">
          <span className="block">{children}</span>
          <span className="block" aria-hidden="true">
            {children}
          </span>
        </span>
      </span>
    </Link>
  )
}
