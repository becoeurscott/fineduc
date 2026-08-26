'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface AuthContextValue {
  token: string | null
  login: (accessToken: string, refreshToken: string) => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'fineduc_access_token'
const REFRESH_KEY = 'fineduc_refresh_token'

/** Reachable without a session: both sign-in pages and the flows that lead to one. */
const PUBLIC_PREFIXES = ['/login', '/personnel', '/first-login', '/setup', '/onboarding']

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY))
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!token && !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
      router.replace('/login')
    }
  }, [hydrated, token, pathname, router])

  const login = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem(TOKEN_KEY, accessToken)
    localStorage.setItem(REFRESH_KEY, refreshToken)
    setToken(accessToken)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    setToken(null)
    router.replace('/login')
  }, [router])

  const value = useMemo<AuthContextValue>(
    () => ({ token, login, logout, isAuthenticated: !!token }),
    [token, login, logout],
  )

  if (!hydrated) return null

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
