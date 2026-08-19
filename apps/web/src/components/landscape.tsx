import Image from 'next/image'
import clsx from 'clsx'

/**
 * Full-bleed landscape backgrounds — the template's signature.
 *
 * The FintechX template is a white, minimal page punctuated by four
 * painted landscapes with wide blue skies (hero meadow, rolling hills,
 * flower valley, dusk field). Content sits on the pale sky, and each
 * landscape dissolves into the next white section through the exact
 * gradient measured off the template:
 *   linear-gradient(transparent 0%, rgba(255,255,255,.7) 25%, #fff 50%)
 * over a 200px band.
 */
export function LandscapeSection({
  img,
  id,
  priority = false,
  fadeTop = false,
  fadeBottom = true,
  className,
  children,
}: {
  img: string
  id?: string
  priority?: boolean
  fadeTop?: boolean
  fadeBottom?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className={clsx('relative overflow-hidden px-5', className)}>
      <Image
        src={img}
        alt=""
        fill
        priority={priority}
        sizes="100vw"
        className="object-cover"
        aria-hidden
      />
      {fadeTop ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-40"
          style={{ background: 'linear-gradient(#fff 0%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0) 100%)' }}
        />
      ) : null}
      {fadeBottom ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[200px]"
          style={{ background: 'linear-gradient(rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 25%, #fff 50%)' }}
        />
      ) : null}
      <div className="relative z-[3] mx-auto max-w-[1200px]">{children}</div>
    </section>
  )
}

/**
 * The three cloud cut-outs that drift at the top of the template's hero
 * (measured: tops -40 / 50 / 80, widths ~600 / 520 / 585, behind the
 * headline at z-index 1).
 */
export function Clouds() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[1]">
      <Image src="/landscape/cloud-1.png" alt="" width={602} height={350} className="absolute -top-10 -left-28 w-[38rem] max-w-none opacity-90" />
      <Image src="/landscape/cloud-2.png" alt="" width={519} height={240} className="absolute top-12 -right-24 w-[32rem] max-w-none opacity-80" />
      <Image src="/landscape/cloud-3.png" alt="" width={584} height={350} className="absolute top-24 left-1/3 hidden w-[36rem] max-w-none opacity-70 lg:block" />
    </div>
  )
}
