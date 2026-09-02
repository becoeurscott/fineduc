import { notFound } from 'next/navigation'
import { LOCALES, contentFor, type Locale } from '@/lib/content'
import { CTA, Section, SectionHeading } from '@/components/site-chrome'
import { Reveal } from '@/components/reveal'
import { ApiConsole, type ConsoleEndpoint } from '@/components/api-console'

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * `/[locale]/api` — the REST API reference.
 *
 * Every route below was read off the controllers rather than designed for
 * this page, and the rate limits are the numbers in `apps/api/src/main.ts`.
 * Docs describing an API the server does not serve are worse than no docs:
 * they fail at integration time, in someone else's codebase, with no way to
 * tell whose fault it is.
 *
 * That is also why the "API keys" card exists. The schema has an `ApiKey`
 * model and nothing authenticates against it, so there is no key-based
 * access to document — saying so plainly is the honest version of a page
 * that would otherwise imply one.
 */

interface Endpoint {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly path: string
  readonly note: { readonly fr: string; readonly en: string }
}

interface Group {
  readonly name: { readonly fr: string; readonly en: string }
  readonly endpoints: readonly Endpoint[]
}

/** Paths are not translated — only the prose beside them is. */
const GROUPS: readonly Group[] = [
  {
    name: { fr: 'Authentification', en: 'Authentication' },
    endpoints: [
      {
        method: 'POST',
        path: '/auth/login-school',
        note: {
          fr: 'Ouvre une session école et renvoie les jetons.',
          en: 'Signs in to a school and returns the tokens.',
        },
      },
      {
        method: 'POST',
        path: '/auth/refresh',
        note: {
          fr: 'Échange un refresh token contre un nouvel accès.',
          en: 'Exchanges a refresh token for a new access token.',
        },
      },
      {
        method: 'GET',
        path: '/auth/me',
        note: { fr: 'L’utilisateur courant et son rôle.', en: 'The current user and their role.' },
      },
      {
        method: 'POST',
        path: '/auth/logout',
        note: { fr: 'Révoque la session.', en: 'Revokes the session.' },
      },
    ],
  },
  {
    name: { fr: 'Élèves', en: 'Students' },
    endpoints: [
      {
        method: 'GET',
        path: '/students',
        note: { fr: 'Liste paginée et filtrable.', en: 'Paginated, filterable list.' },
      },
      {
        method: 'GET',
        path: '/students/:id',
        note: { fr: 'Le dossier complet d’un élève.', en: 'One student’s full record.' },
      },
      {
        method: 'POST',
        path: '/students/:id/enroll',
        note: {
          fr: 'Inscrit l’élève et génère son échéancier.',
          en: 'Enrols the student and generates their instalments.',
        },
      },
      {
        method: 'GET',
        path: '/students/:id/guardians',
        note: { fr: 'Les parents payeurs rattachés.', en: 'The paying guardians attached to them.' },
      },
    ],
  },
  {
    name: { fr: 'Facturation', en: 'Billing' },
    endpoints: [
      {
        method: 'GET',
        path: '/fee-schedules',
        note: { fr: 'Les grilles tarifaires.', en: 'Fee schedules.' },
      },
      {
        method: 'POST',
        path: '/fee-schedules/:id/publish',
        note: {
          fr: 'Publie une version — elle devient immuable.',
          en: 'Publishes a version — it becomes immutable.',
        },
      },
      {
        method: 'GET',
        path: '/invoices/:id',
        note: { fr: 'Une facture et ses tranches.', en: 'One invoice and its instalments.' },
      },
      {
        method: 'GET',
        path: '/invoices/:studentId/statement',
        note: {
          fr: 'Le relevé d’un élève : dû, payé, restant.',
          en: 'A student’s statement: owed, paid, outstanding.',
        },
      },
    ],
  },
  {
    name: { fr: 'Caisse', en: 'Cash desk' },
    endpoints: [
      {
        method: 'POST',
        path: '/cash-sessions',
        note: {
          fr: 'Ouvre une caisse avec un fonds de départ.',
          en: 'Opens a session with a starting float.',
        },
      },
      {
        method: 'POST',
        path: '/cash-sessions/payments',
        note: { fr: 'Encaisse un paiement en espèces.', en: 'Records a cash payment.' },
      },
      {
        method: 'GET',
        path: '/cash-sessions/:id/expected',
        note: {
          fr: 'Le montant attendu en caisse à cet instant.',
          en: 'What the drawer should hold right now.',
        },
      },
      {
        method: 'POST',
        path: '/cash-sessions/:id/close',
        note: {
          fr: 'Clôture avec comptage ; tout écart exige un motif.',
          en: 'Closes with a count; any variance needs a reason.',
        },
      },
    ],
  },
  {
    name: { fr: 'Paiement en ligne', en: 'Online payment' },
    endpoints: [
      {
        method: 'GET',
        path: '/pay/:token',
        note: {
          fr: 'La page parent, publique, sans session.',
          en: 'The public parent page — no session needed.',
        },
      },
      {
        method: 'POST',
        path: '/pay/:token/initiate',
        note: {
          fr: 'Démarre un paiement mobile money ou carte.',
          en: 'Starts a mobile money or card payment.',
        },
      },
    ],
  },
  {
    name: { fr: 'Moratoires', en: 'Payment delays' },
    endpoints: [
      {
        method: 'GET',
        path: '/moratoire/:token',
        note: {
          fr: 'La demande de délai, côté parent.',
          en: 'The parent-facing delay request.',
        },
      },
      {
        method: 'POST',
        path: '/moratoriums/:id/approve',
        note: {
          fr: 'Accorde le délai et replanifie les tranches.',
          en: 'Grants the delay and reschedules the instalments.',
        },
      },
      {
        method: 'POST',
        path: '/moratoriums/:id/refuse',
        note: { fr: 'Refuse la demande, avec motif.', en: 'Refuses the request, with a reason.' },
      },
    ],
  },
  {
    name: { fr: 'Abonnement', en: 'Subscription' },
    endpoints: [
      {
        method: 'GET',
        path: '/tenant/subscription',
        note: {
          fr: 'Le plan, l’échéance et le temps restant.',
          en: 'The plan, the deadline and the time remaining.',
        },
      },
      {
        method: 'POST',
        path: '/tenant/subscription/checkout',
        note: { fr: 'Ouvre un paiement de renouvellement.', en: 'Opens a renewal payment.' },
      },
    ],
  },
  {
    name: { fr: 'Service', en: 'Service' },
    endpoints: [
      { method: 'GET', path: '/health', note: { fr: 'Sonde de disponibilité.', en: 'Liveness probe.' } },
      {
        method: 'GET',
        path: '/health/ready',
        note: {
          fr: 'Base de données et Redis joignables.',
          en: 'Database and Redis reachable.',
        },
      },
    ],
  },
]

/**
 * The console's list, derived from the same catalogue so the two can never
 * drift. Bodies are shapes, not working payloads: real ids belong to a real
 * school, and shipping one here would invite someone to POST against it.
 */
const BODIES: Record<string, Record<string, string>> = {
  '/auth/login-school': { email: 'vous@ecole.cm', password: '...' },
  '/students/:id/enroll': { classGroupId: '...', feeScheduleId: '...' },
  '/cash-sessions': { openingFloatMinor: '0' },
  '/cash-sessions/payments': { instalmentId: '...', amountMinor: '0' },
  '/tenant/subscription/checkout': {
    plan: 'essentiel',
    billingPeriod: 'monthly',
    payerPhoneE164: '+237670000000',
  },
}

function consoleEndpoints(locale: Locale): ConsoleEndpoint[] {
  return GROUPS.flatMap((group) =>
    group.endpoints.map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      label: endpoint.note[locale],
      ...(BODIES[endpoint.path] ? { body: JSON.stringify(BODIES[endpoint.path], null, 2) } : {}),
    })),
  )
}

const METHOD_TONE: Record<Endpoint['method'], string> = {
  GET: 'bg-positive-soft text-positive',
  POST: 'bg-accent-soft text-accent',
  PATCH: 'bg-warning-soft text-ink',
  DELETE: 'bg-danger-soft text-danger',
}

export default async function ApiPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = contentFor(locale)
  const a = t.api

  return (
    <>
      <Section>
        <Reveal>
          <SectionHeading eyebrow={a.eyebrow} title={a.title} subtitle={a.subtitle} />
        </Reveal>

        {/* Base URL and auth first: the two things without which no request
            below will work at all. */}
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <Reveal distance="sm">
            <article className="mkt-card-lg h-full">
              <h2 className="mkt-h3">{a.baseUrlTitle}</h2>
              <pre className="mt-4 overflow-x-auto rounded-[var(--radius-control)] bg-ink px-4 py-3 text-[13px] text-white">
                <code>https://api.fineeduc.com</code>
              </pre>
            </article>
          </Reveal>

          <Reveal distance="sm" delay={60}>
            <article className="mkt-card-lg h-full">
              <h2 className="mkt-h3">{a.authTitle}</h2>
              <p className="mt-3 text-[15px] leading-[1.6] text-slate">{a.authBody}</p>
              <pre className="mt-4 overflow-x-auto rounded-[var(--radius-control)] bg-ink px-4 py-3 text-[13px] text-white">
                <code>Authorization: Bearer &lt;access_token&gt;</code>
              </pre>
            </article>
          </Reveal>
        </div>

        {/* The console sits ABOVE the reference on purpose: the page exists
            to make requests, and a reader who wants to try one should not
            have to scroll past a catalogue to find the thing that does it. */}
        <div className="mt-8">
          <Reveal distance="sm">
            <ApiConsole endpoints={consoleEndpoints(locale)} locale={locale} />
          </Reveal>
        </div>

        <div className="mt-16">
          <Reveal>
            <h2 className="mkt-h2">{a.endpointsTitle}</h2>
          </Reveal>

          <div className="mt-8 space-y-10">
            {GROUPS.map((group, gi) => (
              <Reveal key={group.name.en} delay={gi * 40} distance="sm">
                <section>
                  <h3 className="text-[13px] font-semibold tracking-wide text-slate uppercase">
                    {group.name[locale]}
                  </h3>
                  <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-mkt-card)] border border-line bg-white">
                    {group.endpoints.map((endpoint) => (
                      <li
                        key={endpoint.method + endpoint.path}
                        className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                      >
                        <span
                          className={`inline-flex w-fit shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${METHOD_TONE[endpoint.method]}`}
                        >
                          {endpoint.method}
                        </span>
                        {/* The path can be long on a phone; it scrolls in
                            place rather than widening the page. */}
                        <code className="min-w-0 shrink-0 overflow-x-auto font-mono text-[13px] text-ink">
                          {endpoint.path}
                        </code>
                        <span className="text-[14px] leading-[1.5] text-slate sm:ml-auto sm:text-right">
                          {endpoint.note[locale]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Errors, limits, and the one thing that does not exist. */}
        <div className="mt-16 grid gap-4 lg:grid-cols-3">
          <Reveal distance="sm">
            <article className="mkt-card-lg h-full">
              <h2 className="mkt-h3">{a.errorsTitle}</h2>
              <p className="mt-3 text-[15px] leading-[1.6] text-slate">{a.errorsBody}</p>
              <pre className="mt-4 overflow-x-auto rounded-[var(--radius-control)] bg-ink px-4 py-3 text-[12px] leading-[1.6] text-white">
                <code>{`{
  "type": ".../errors/HTTP_402",
  "title": "PaymentRequired",
  "status": 402,
  "code": "SUBSCRIPTION_LAPSED",
  "detail": "…",
  "traceId": "…"
}`}</code>
              </pre>
            </article>
          </Reveal>

          <Reveal distance="sm" delay={60}>
            <article className="mkt-card-lg h-full">
              <h2 className="mkt-h3">{a.limitsTitle}</h2>
              <p className="mt-3 text-[15px] leading-[1.6] text-slate">{a.limitsBody}</p>
            </article>
          </Reveal>

          <Reveal distance="sm" delay={120}>
            <article className="mkt-card-lg h-full">
              <h2 className="mkt-h3">{a.keysTitle}</h2>
              <p className="mt-3 text-[15px] leading-[1.6] text-slate">{a.keysBody}</p>
            </article>
          </Reveal>
        </div>
      </Section>

      <Section tone="ink">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mkt-h2 text-balance text-white">{t.finalCta.title}</h2>
            <p className="mt-5 text-[17px] leading-[1.6] text-white/65">{t.finalCta.subtitle}</p>
            <div className="mt-8">
              <CTA href={`/${locale}/inscription`} onInk>
                {t.finalCta.cta}
              </CTA>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  )
}
