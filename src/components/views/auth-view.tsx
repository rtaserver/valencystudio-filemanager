'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/logo'
import { navigate } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'
import { toast } from 'sonner'
import { Loader2, Info, ShieldCheck } from 'lucide-react'

export function AuthView({ initialMode }: { initialMode: 'login' | 'register' }) {
  const { login, register, site } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const switchMode = (m: 'login' | 'register') => {
    setMode(m)
    navigate(m === 'login' ? '/login' : '/register')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email.trim(), password)
        toast.success('Signed in')
        navigate('/files')
      } else {
        if (password !== confirm) {
          toast.error('Passwords do not match.')
          setBusy(false)
          return
        }
        await register(email.trim(), password, name.trim() || undefined)
        toast.success('Account created')
        navigate('/files')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-border/60 shrink-0">
        <button onClick={() => navigate('/')} className="cursor-pointer"><Logo /></button>
        <span className="micro-label hidden sm:block">Storage node · online</span>
      </header>

      <main className="flex-1 grid lg:grid-cols-[1.1fr_1fr]">
        {/* Brand panel */}
        <aside className="hidden lg:flex flex-col justify-between bg-grid-fine border-r border-border/60 p-10">
          <div />
          <div className="max-w-md space-y-8">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight leading-snug">
                Your files, stored on<br />encrypted cloud infrastructure.
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Direct streaming pipelines up to 2 GB per file, 0-byte disk spooling,
                byte-range video seek, and protected share links — a private storage
                console with zero hosting bills.
              </p>
            </div>
            <dl className="divide-y divide-border/60 border-y border-border/60">
              {[
                ['STORAGE ENGINE', 'High-Speed Cloud Vault · 2 GB Stream'],
                ['STREAMING', 'HTTP 206 Range · 0-byte spool'],
                ['ACCESS', 'Owner / Admin / User · audit logs'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-2.5 gap-4">
                  <dt className="micro-label">{k}</dt>
                  <dd className="font-mono text-[11px] text-foreground/80 text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.18em]">
            ValencyStudio · File Console
          </p>
        </aside>

        {/* Form panel */}
        <div className="flex items-center justify-center px-4 py-12">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm"
          >
            <div className="mb-7">
              <div className="flex items-center gap-1 mb-6">
                {(['login', 'register'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    className={`px-3 h-8 text-[13px] font-medium rounded-md transition-colors cursor-pointer ${
                      mode === m
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                {mode === 'login' ? 'Sign in to the console' : 'Create your account'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                {mode === 'login'
                  ? 'Manage and share your encrypted cloud files.'
                  : `Join ${site.siteName}.`}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required placeholder="you@domain.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={6} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              </div>
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input id="confirm" type="password" required minLength={6} placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
                </div>
              )}

              <Button type="submit" className="w-full gap-2" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </Button>
            </form>

            {!site.allowRegistration && mode === 'register' && (
              <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-[13px] text-muted-foreground flex gap-2.5">
                <Info className="size-4 text-amber-500 shrink-0 mt-0.5" />
                Registration is currently disabled by the administrator.
              </div>
            )}

            <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              <span className="font-mono text-[11px]">End-to-end encrypted private vault</span>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
