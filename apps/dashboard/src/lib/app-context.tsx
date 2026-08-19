'use client'

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { CurrentUser } from '@fineduc/contracts'
import { getApi, qk } from './api/index'
import { intlLocale, translate, type Locale, type TranslationKey } from './i18n'

interface AppContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  intlLocale: string
  user: CurrentUser | undefined
  userLoading: boolean
}

const AppContext = createContext<AppContextValue | null>(null)

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The director's figures must be fresh but not chatty: 30s stale
        // matches the "cached 30s, auto-refresh 60s" spec in
        // ARCHITECTURE.md §13, and keeps data use low on a 3G phone.
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function InnerProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('fr')
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: qk.currentUser,
    queryFn: () => getApi().getCurrentUser(),
  })

  const value = useMemo<AppContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      intlLocale: intlLocale(locale),
      user,
      userLoading,
    }),
    [locale, user, userLoading],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <InnerProvider>{children}</InnerProvider>
    </QueryClientProvider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProviders>')
  return ctx
}
