'use client'

import { useMemo, useState } from 'react'
import type { Locale } from '@/lib/content'

/**
 * A live console against the real API.
 *
 * Two decisions worth knowing, because both are about not hurting anyone:
 *
 * 1. The token lives in React state and NOTHING else. Not localStorage, not
 *    sessionStorage, not a cookie. This page is public, so a token persisted
 *    here would outlive the tab on a shared or school-office machine and be
 *    readable by any later script on the origin. Closing the tab must end it.
 *
 * 2. Writes are armed, not one-click. Every request here goes to PRODUCTION —
 *    `POST /cash-sessions/payments` records a real payment against a real
 *    school. A console that fires those as readily as a GET would eventually
 *    have someone "just trying it" against live money, so anything that is
 *    not a GET needs a deliberate second action.
 */

export interface ConsoleEndpoint {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly path: string
  readonly label: string
  /** Prefilled body for methods that take one. */
  readonly body?: string
}

const COPY = {
  fr: {
    heading: 'Essayer une requête',
    intro:
      'Ces appels partent vers l’API de production, depuis votre navigateur. Rien ne transite par nos serveurs web.',
    tokenLabel: 'Jeton d’accès',
    tokenPlaceholder: 'Collez votre jeton (ou connectez-vous ci-dessous)',
    tokenHelp:
      'Gardé en mémoire uniquement, jamais enregistré. Fermez l’onglet et il disparaît.',
    loginTitle: 'Obtenir un jeton',
    email: 'E-mail',
    password: 'Mot de passe',
    loginBtn: 'Se connecter',
    loggingIn: 'Connexion…',
    loginOk: 'Jeton obtenu.',
    endpointLabel: 'Requête',
    pathLabel: 'Chemin',
    pathHelp: 'Remplacez :id et les autres paramètres par de vraies valeurs.',
    bodyLabel: 'Corps (JSON)',
    send: 'Envoyer',
    sending: 'Envoi…',
    arm: 'Cette requête MODIFIE des données réelles',
    armHelp: 'Cochez pour confirmer que vous voulez écrire en production.',
    responseLabel: 'Réponse',
    empty: 'Aucune requête envoyée.',
    networkError:
      'Requête impossible : réseau, CORS, ou API injoignable. Le service peut mettre ~40 s à démarrer s’il dormait.',
    noToken: 'Ajoutez un jeton : cette route exige une session.',
  },
  en: {
    heading: 'Try a request',
    intro:
      'These calls go to the production API, straight from your browser. Nothing passes through our web servers.',
    tokenLabel: 'Access token',
    tokenPlaceholder: 'Paste your token (or sign in below)',
    tokenHelp: 'Held in memory only, never stored. Close the tab and it is gone.',
    loginTitle: 'Get a token',
    email: 'Email',
    password: 'Password',
    loginBtn: 'Sign in',
    loggingIn: 'Signing in…',
    loginOk: 'Token acquired.',
    endpointLabel: 'Request',
    pathLabel: 'Path',
    pathHelp: 'Replace :id and other parameters with real values.',
    bodyLabel: 'Body (JSON)',
    send: 'Send',
    sending: 'Sending…',
    arm: 'This request CHANGES real data',
    armHelp: 'Tick to confirm you mean to write to production.',
    responseLabel: 'Response',
    empty: 'No request sent yet.',
    networkError:
      'Request failed: network, CORS, or the API is unreachable. It can take ~40s to wake if it was asleep.',
    noToken: 'Add a token — this route needs a session.',
  },
} as const

const BASE_URL = 'https://api.fineeduc.com'

/** Routes that work with no token, so the console does not demand one wrongly. */
const PUBLIC_PATHS = ['/health', '/health/ready', '/auth/login-school', '/pay/', '/moratoire/']

interface Result {
  readonly status: number | null
  readonly ms: number
  readonly body: string
  readonly error?: string
}

export function ApiConsole({ endpoints, locale }: { endpoints: readonly ConsoleEndpoint[]; locale: Locale }) {
  const t = COPY[locale]

  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginNote, setLoginNote] = useState<string | null>(null)

  const [selected, setSelected] = useState(0)
  const endpoint = endpoints[selected] ?? endpoints[0]!
  const [path, setPath] = useState(endpoint.path)
  const [body, setBody] = useState(endpoint.body ?? '')
  const [armed, setArmed] = useState(false)

  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const isWrite = endpoint.method !== 'GET'
  const needsToken = useMemo(
    () => !PUBLIC_PATHS.some((p) => path.startsWith(p)),
    [path],
  )

  function choose(index: number) {
    const next = endpoints[index]!
    setSelected(index)
    setPath(next.path)
    setBody(next.body ?? '')
    // Disarm on every change: consent is to ONE request, not to a mode.
    setArmed(false)
    setResult(null)
  }

  async function signIn() {
    setLoggingIn(true)
    setLoginNote(null)
    try {
      const res = await fetch(`${BASE_URL}/auth/login-school`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json()) as { accessToken?: string; detail?: string }
      if (res.ok && data.accessToken) {
        setToken(data.accessToken)
        setLoginNote(t.loginOk)
      } else {
        setLoginNote(data.detail ?? `HTTP ${res.status}`)
      }
    } catch {
      setLoginNote(t.networkError)
    } finally {
      setLoggingIn(false)
    }
  }

  async function send() {
    setSending(true)
    setResult(null)
    const started = performance.now()
    try {
      const headers: Record<string, string> = {}
      if (token) headers.authorization = `Bearer ${token}`
      if (isWrite && body.trim()) headers['content-type'] = 'application/json'

      const res = await fetch(`${BASE_URL}${path}`, {
        method: endpoint.method,
        headers,
        body: isWrite && body.trim() ? body : undefined,
      })

      const text = await res.text()
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* not JSON — show it raw rather than pretend */
      }
      setResult({ status: res.status, ms: Math.round(performance.now() - started), body: pretty })
    } catch {
      setResult({
        status: null,
        ms: Math.round(performance.now() - started),
        body: '',
        error: t.networkError,
      })
    } finally {
      setSending(false)
      // Re-arm required for the next write.
      setArmed(false)
    }
  }

  const blocked = (isWrite && !armed) || (needsToken && !token)
  const inputClass =
    'h-11 w-full rounded-[var(--radius-control)] border border-line bg-white px-3 text-[14px] text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <div className="mkt-card-lg">
      <h2 className="mkt-h3">{t.heading}</h2>
      <p className="mt-2 text-[14px] leading-[1.6] text-slate">{t.intro}</p>

      {/* --- credentials ------------------------------------------------- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div>
          <label htmlFor="api-token" className="text-[13px] font-medium text-ink">
            {t.tokenLabel}
          </label>
          <input
            id="api-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t.tokenPlaceholder}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className="mt-1.5 text-[12px] text-slate">{t.tokenHelp}</p>
        </div>

        <div>
          <p className="text-[13px] font-medium text-ink">{t.loginTitle}</p>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.email}
              className={inputClass}
            />
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.password}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={loggingIn || !email || !password}
              className="h-11 shrink-0 rounded-[var(--radius-control)] bg-ink px-4 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loggingIn ? t.loggingIn : t.loginBtn}
            </button>
          </div>
          {loginNote ? <p className="mt-1.5 text-[12px] text-slate">{loginNote}</p> : null}
        </div>
      </div>

      {/* --- request ----------------------------------------------------- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div>
          <label htmlFor="api-endpoint" className="text-[13px] font-medium text-ink">
            {t.endpointLabel}
          </label>
          <select
            id="api-endpoint"
            value={selected}
            onChange={(e) => choose(Number(e.target.value))}
            className={`mt-1.5 ${inputClass}`}
          >
            {endpoints.map((e, i) => (
              <option key={e.method + e.path} value={i}>
                {e.method} {e.path} — {e.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="api-path" className="text-[13px] font-medium text-ink">
            {t.pathLabel}
          </label>
          <input
            id="api-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            spellCheck={false}
            className={`mt-1.5 font-mono ${inputClass}`}
          />
          <p className="mt-1.5 text-[12px] text-slate">{t.pathHelp}</p>
        </div>
      </div>

      {isWrite ? (
        <div className="mt-4">
          <label htmlFor="api-body" className="text-[13px] font-medium text-ink">
            {t.bodyLabel}
          </label>
          <textarea
            id="api-body"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-white p-3 font-mono text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      ) : null}

      {/* The arming step. Deliberately loud, and reset after every send. */}
      {isWrite ? (
        <label className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-danger bg-danger-soft p-3">
          <input
            type="checkbox"
            checked={armed}
            onChange={(e) => setArmed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-danger)]"
          />
          <span>
            <span className="block text-[13px] font-semibold text-danger">{t.arm}</span>
            <span className="mt-0.5 block text-[12px] text-slate">{t.armHelp}</span>
          </span>
        </label>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || blocked}
          className="h-11 rounded-[var(--radius-mkt-pill)] bg-accent px-6 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? t.sending : t.send}
        </button>
        {needsToken && !token ? <span className="text-[13px] text-slate">{t.noToken}</span> : null}
      </div>

      {/* --- response ---------------------------------------------------- */}
      <div className="mt-6">
        <p className="text-[13px] font-medium text-ink">{t.responseLabel}</p>
        {result ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              {result.status !== null ? (
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[12px] font-semibold ${
                    result.status < 300
                      ? 'bg-positive-soft text-positive'
                      : result.status < 500
                        ? 'bg-warning-soft text-ink'
                        : 'bg-danger-soft text-danger'
                  }`}
                >
                  {result.status}
                </span>
              ) : null}
              <span className="text-slate">{result.ms} ms</span>
            </div>
            {result.error ? (
              <p className="mt-2 text-[13px] text-danger">{result.error}</p>
            ) : (
              <pre className="mt-2 max-h-96 overflow-auto rounded-[var(--radius-control)] bg-ink p-4 text-[12px] leading-[1.6] text-white">
                <code>{result.body}</code>
              </pre>
            )}
          </>
        ) : (
          <p className="mt-2 text-[13px] text-slate">{t.empty}</p>
        )}
      </div>
    </div>
  )
}
