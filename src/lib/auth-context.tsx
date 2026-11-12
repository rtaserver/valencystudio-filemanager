'use client'

import { createContext, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/client-api'

export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: string
  quota: number
  isActive: boolean
  createdAt: string
}

export interface SiteInfo {
  siteName: string
  siteDescription: string
  announcement: string
  allowRegistration: boolean
}

interface MeResponse {
  user: SessionUser | null
  isPrivileged?: boolean
  stats?: { fileCount: number; usedBytes: number }
  site: SiteInfo
}

export interface AuthContextValue {
  user: SessionUser | null
  privileged: boolean
  stats: { fileCount: number; usedBytes: number } | null
  site: SiteInfo
  loading: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name?: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>(null as never)

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

export function useAuthState(): AuthContextValue {
  const queryClient = useQueryClient()
  const { data, isLoading, refetch } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/auth/me'),
    staleTime: 10_000,
    retry: 1,
    // Realtime events invalidate this query instantly (see RealtimeBridge);
    // this interval is only a backstop while the socket is unreachable.
    refetchInterval: 45_000,
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    await refetch()
  }

  const login = async (email: string, password: string) => {
    await api('/api/auth/login', { method: 'POST', body: { email, password } })
    await refresh()
  }

  const register = async (email: string, password: string, name?: string) => {
    await api('/api/auth/register', { method: 'POST', body: { email, password, name } })
    await refresh()
  }

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' })
    queryClient.clear()
    await refresh()
  }

  return {
    user: data?.user ?? null,
    privileged: !!data?.isPrivileged,
    stats: data?.stats ?? null,
    site: data?.site ?? { siteName: 'ValencyStudio File Manager', siteDescription: '', announcement: '', allowRegistration: true },
    loading: isLoading,
    refresh,
    login,
    register,
    logout,
  }
}
