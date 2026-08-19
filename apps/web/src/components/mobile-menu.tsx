'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { contentFor, type Locale } from '@/lib/content'

/**
 * The nav links live behind this button below `md`, because there is no
 * room for them in a 343px pill. The template does exactly the same: its
 * mobile variant carries only the logo and this button.
 *
 * Measured off that variant: a 32px #1d1d1d circle holding two 20x2 white
 * bars with a 6px gap, and a full-screen scrim of rgba(0,0,0,.3) with a
 * 10px backdrop blur.
 */
export function MobileMenu({ locale }: { locale: Locale }) {
  const t = contentFor(locale)
  const other: Locale = locale === 'fr' ? 'en' : 'fr'
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // A link inside the panel may only change the hash, which does not
  // unmount anything — so close on navigation rather than on click, and
  // cover the Android back button at the same time.
  useEffect(() => setOpen(false), [pathname])

  // Escape is the one affordance a keyboard user expects from a dialog,
  // and locking the body stops the page scrolling behind the scrim.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  const links = [
    { href: `/${locale}#fonctionnalites`, label: t.nav.features },
    { href: `/${locale}/tarifs`, label: t.nav.pricing },
    { href: `/${locale}/securite`, label: t.nav.security },
  ]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? t.nav.menuClose : t.nav.menuOpen}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-[#1d1d1d] md:hidden"
      >
        <span className="grid gap-[6px]">
          <span
            className={clsx(
              'block h-[2px] w-5 rounded-[2px] bg-white transition-transform duration-200',
              open && 'translate-y-[4px] rotate-45',
            )}
          />
          <span
            className={clsx(
              'block h-[2px] w-5 rounded-[2px] bg-white transition-transform duration-200',
              open && '-translate-y-[4px] -rotate-45',
            )}
          />
        </span>
      </button>

      {/* Scrim. Kept mounted so opacity can transition; `invisible` takes it
          out of the a11y tree and off the hit-test when closed. */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={clsx(
          'fixed inset-0 top-0 z-30 bg-black/30 backdrop-blur-[10px] transition-opacity duration-300 md:hidden',
          open ? 'opacity-100' : 'invisible opacity-0',
        )}
      />

      <div
        id="mobile-menu"
        hidden={!open}
        className={clsx(
          'fixed inset-x-5 top-[84px] z-40 rounded-[10px] bg-white p-2.5 shadow-[0_0_0_2px_rgba(221,229,237,0.7)] transition-all duration-200 md:hidden',
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
        )}
      >
        <nav aria-label={t.nav.menuOpen} className="flex flex-col">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-[15px] font-medium text-ink hover:bg-[#edf1f4]"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href={`/${other}`}
            hrefLang={other}
            onClick={() => setOpen(false)}
            className="mkt-link mt-1 border-t border-[#dde5ed] px-3 pt-4 pb-2 text-[15px] font-medium text-slate hover:text-ink"
          >
            {other.toUpperCase()}
          </Link>
        </nav>
      </div>
    </>
  )
}
