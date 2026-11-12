'use client'

import { useCallback, useEffect, useState } from 'react'

export interface Route {
  path: string
  segments: string[]
  query: URLSearchParams
  raw: string
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [pathPart, queryPart] = raw.split('?')
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`
  return {
    path,
    segments: path.split('/').filter(Boolean),
    query: new URLSearchParams(queryPart || ''),
    raw,
  }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { path: '/', segments: [], query: new URLSearchParams(), raw: '/' } : parseHash()
  )
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(path: string) {
  const clean = path.startsWith('#') ? path.slice(1) : path
  if (window.location.hash === `#${clean}`) return
  window.location.hash = clean
}

export function useNavigate() {
  return useCallback((path: string) => navigate(path), [])
}
