'use client'

import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext, useAuthState } from '@/lib/auth-context'
import { useHashRoute, navigate } from '@/lib/router'
import { LandingView } from '@/components/views/landing'
import { AuthView } from '@/components/views/auth-view'
import { DashboardShell } from '@/components/views/dashboard-shell'
import { PublicFileView } from '@/components/views/public-file'
import { RealtimeBridge } from '@/components/realtime-provider'
import { Logo } from '@/components/logo'

function Splash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <div className="animate-pulse-soft">
        <Logo size={52} />
      </div>
      <div className="text-xs text-muted-foreground tracking-wide">Loading your workspace…</div>
    </div>
  )
}

function Router() {
  const route = useHashRoute()
  const auth = useAuthState()
  const seg = route.segments
  const isAuthPage = seg[0] === 'login' || seg[0] === 'register'
  // Hash routes only exist on the client — keep the first (hydration) render
  // identical to the server output (Splash), then switch to the real view.
  const [mounted, setMounted] = useState(false)
  // Intentional client-only hydration flag (splash until mounted)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  // redirect signed-in users away from auth pages
  useEffect(() => {
    if (!auth.loading && auth.user && isAuthPage) {
      navigate('/files')
    }
  }, [auth.loading, auth.user, isAuthPage])

  if (!mounted) return <Splash />
  if (seg[0] === 'f' && seg[1]) {
    return <PublicFileView slug={seg[1]} />
  }
  if (auth.loading) return <Splash />
  if (isAuthPage) {
    if (auth.user) return <Splash />
    return <AuthView initialMode={seg[0] === 'register' ? 'register' : 'login'} />
  }
  if (!auth.user) return <LandingView />
  return <DashboardShell route={route.path} />
}

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  )
}

function AppInner() {
  const auth = useAuthState()

  // register the PWA service worker (offline shell) — silently skipped where unsupported
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    if (document.readyState === 'complete') onLoad()
    else {
      window.addEventListener('load', onLoad, { once: true })
      return () => window.removeEventListener('load', onLoad)
    }
  }, [])

  return (
    <AuthContext.Provider value={auth}>
      <RealtimeBridge />
      <Router />
    </AuthContext.Provider>
  )
}
