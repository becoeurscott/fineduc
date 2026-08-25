'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'
const ADMIN_KEY_STORAGE = 'fineduc_admin_key'

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth()
  const router = useRouter()

  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  if (isAuthenticated) {
    router.replace('/')
    return null
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSending(true)

    try {
      const res = await fetch(`${API_URL}/admin/signups`, {
        headers: { 'x-admin-key': apiKey },
      })

      if (res.ok) {
        localStorage.setItem(ADMIN_KEY_STORAGE, apiKey)
        login('admin-key-session', 'admin-key-refresh')
        router.replace('/')
        return
      }

      setError('Clé API invalide.')
    } catch {
      setError('Impossible de joindre le serveur.')
    } finally {
      setSending(false)
    }
  }

  const inputClass =
    'h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-slate/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="inline-grid size-12 place-items-center rounded-xl bg-accent text-lg font-bold text-white">
            F
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Fineduc Admin</h1>
          <p className="mt-1 text-sm text-slate">Administration de la plateforme</p>
        </div>

        <form onSubmit={(e) => void handleLogin(e)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Clé API administrateur</span>
            <input
              type="password"
              required
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Entrez votre clé API"
              className={inputClass}
            />
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={sending}
            className="mt-2 h-11 rounded-[var(--radius-control)] bg-ink text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
          >
            {sending ? 'Vérification…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
