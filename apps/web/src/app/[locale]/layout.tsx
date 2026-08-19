import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { notFound } from 'next/navigation'
import '../globals.css'
import { LOCALES, contentFor, type Locale } from '@/lib/content'
import { SiteFooter, SiteHeader, WhatsAppButton } from '@/components/site-chrome'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })

/** Both locales are prerendered as real pages, so each is independently indexable. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const t = contentFor(locale)
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: {
      languages: { fr: '/fr', en: '/en' },
    },
    openGraph: { title: t.meta.title, description: t.meta.description, locale },
  }
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = contentFor(locale)

  return (
    <html lang={locale} className={inter.variable}>
      <body className="bg-white">
        <SiteHeader locale={locale} />
        <main>{children}</main>
        <SiteFooter locale={locale} />
        <WhatsAppButton label={t.finalCta.whatsapp} />
      </body>
    </html>
  )
}
