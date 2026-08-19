import { AGE_BUCKET_COLORS, PAYMENT_METHOD_COLORS } from '@fineduc/ui'

/**
 * The wide, browser-framed dashboard the template shows at the bottom of
 * the hero and again in the Overview section (its screenshots are of the
 * FintechX product — ours has to be OUR product, so this is a hand-built
 * replica of the real Fineduc director screen, same trick as PhoneMock:
 * crisp at any density, tiny on 3G, real translatable text, and the same
 * validated colour tokens as the app itself).
 */
export function DesktopMock({ locale }: { locale: 'fr' | 'en' }) {
  const fr = locale === 'fr'
  const ageing = [
    { bucket: '0-30' as const, height: 62 },
    { bucket: '31-60' as const, height: 26 },
    { bucket: '61-90' as const, height: 24 },
    { bucket: '90+' as const, height: 54 },
  ]
  const methods = [
    { key: 'mobile_money' as const, label: 'Mobile money', share: 52 },
    { key: 'cash' as const, label: fr ? 'Espèces' : 'Cash', share: 31 },
    { key: 'bank_transfer' as const, label: fr ? 'Virement' : 'Transfer', share: 14 },
    { key: 'other' as const, label: fr ? 'Autres' : 'Other', share: 3 },
  ]
  const stats = [
    { label: fr ? 'Encaissé aujourd’hui' : 'Collected today', value: '345 000 FCFA', tone: 'text-ink' },
    { label: fr ? 'Encaissé cette semaine' : 'Collected this week', value: '1 890 000 FCFA', tone: 'text-ink' },
    { label: fr ? 'Taux de recouvrement' : 'Recovery rate', value: '70,9 %', tone: 'text-warning' },
    { label: fr ? 'Reste à recouvrer' : 'Outstanding', value: '6 330 000 FCFA', tone: 'text-danger' },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-raised)]">
      {/* browser chrome */}
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-[#f28778]" />
          <span className="size-2.5 rounded-full bg-[#fdbb6e]" />
          <span className="size-2.5 rounded-full bg-[#8ae389]" />
        </span>
        <span className="mx-auto w-full max-w-xs truncate rounded-full bg-canvas px-4 py-1 text-center text-[11px] text-slate">
          app.fineduc.io
        </span>
        <span className="w-10" aria-hidden="true" />
      </div>

      <div className="bg-canvas p-3 sm:p-4">
        {/* app header — tenant + a real in-app nav, so this reads as the
            whole product (Overview / Analytics / Charts …), not one widget */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-ink text-[10px] font-bold text-white">F</span>
            <div className="leading-tight">
              <p className="text-[11px] font-semibold text-ink">École Bilingue Excellence</p>
              <p className="text-[8px] text-slate">{fr ? 'Directeur' : 'Director'} · 2026-2027</p>
            </div>
          </div>
          <nav aria-label="Dashboard sections" className="flex items-center gap-1 rounded-full bg-white p-1">
            {[
              { label: fr ? 'Vue d’ensemble' : 'Overview', active: true },
              { label: fr ? 'Analytique' : 'Analytics', active: false },
              { label: fr ? 'Graphiques' : 'Charts', active: false },
              { label: fr ? 'Élèves' : 'Students', active: false },
            ].map((tab) => (
              <span
                key={tab.label}
                className={
                  tab.active
                    ? 'rounded-full bg-ink px-2.5 py-1 text-[9px] font-medium text-white'
                    : 'rounded-full px-2.5 py-1 text-[9px] font-medium text-slate'
                }
              >
                {tab.label}
              </span>
            ))}
          </nav>
          <span className="hidden items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[9px] font-medium text-slate sm:inline-flex">
            <span className="size-1.5 rounded-full bg-positive" aria-hidden="true" />
            {fr ? 'Temps réel' : 'Live'}
          </span>
        </div>

        {/* stat tiles */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-white p-2.5 sm:p-3">
              <p className="truncate text-[8px] text-slate sm:text-[9px]">{s.label}</p>
              <p className={`mt-1 truncate text-[12px] font-semibold tracking-tight sm:text-[15px] ${s.tone}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 lg:grid-cols-[1.6fr_1fr]">
          {/* collections chart */}
          <div className="rounded-xl border border-line bg-white p-3">
            <p className="mb-2 text-[9px] font-medium text-slate">
              {fr ? 'Encaissements — 30 jours' : 'Collections — 30 days'}
            </p>
            <svg viewBox="0 0 480 110" className="h-28 w-full" role="img" aria-label="Collections trend">
              <defs>
                <linearGradient id="deskFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 84 L37 72 L74 88 L111 60 L148 68 L185 36 L222 52 L259 16 L296 44 L333 60 L370 32 L407 48 L444 24 L480 30 L480 110 L0 110 Z"
                fill="url(#deskFill)"
              />
              <path
                d="M0 84 L37 72 L74 88 L111 60 L148 68 L185 36 L222 52 L259 16 L296 44 L333 60 L370 32 L407 48 L444 24 L480 30"
                fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
              />
            </svg>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {/* method mix */}
            <div className="rounded-xl border border-line bg-white p-3">
              <p className="mb-1.5 text-[9px] font-medium text-slate">{fr ? 'Moyens de paiement' : 'Payment methods'}</p>
              <ul className="space-y-1">
                {methods.map((m) => (
                  <li key={m.key} className="flex items-center gap-1.5">
                    <span className="size-1.5 shrink-0 rounded-[2px]" style={{ backgroundColor: PAYMENT_METHOD_COLORS[m.key] }} aria-hidden="true" />
                    <span className="flex-1 truncate text-[8px] text-slate">{m.label}</span>
                    <span className="text-[8px] font-medium text-ink">{m.share}%</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* ageing */}
            <div className="rounded-xl border border-line bg-white p-3">
              <p className="mb-1.5 text-[9px] font-medium text-slate">{fr ? 'Ancienneté des impayés' : 'Arrears ageing'}</p>
              <div className="flex h-[46px] items-end justify-between gap-1.5">
                {ageing.map((b) => (
                  <div key={b.bucket} className="flex flex-1 flex-col items-center gap-0.5">
                    <div className="w-full rounded-t-[3px]" style={{ height: `${b.height}%`, backgroundColor: AGE_BUCKET_COLORS[b.bucket] }} />
                    <span className="text-[7px] text-slate-muted">{b.bucket}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
