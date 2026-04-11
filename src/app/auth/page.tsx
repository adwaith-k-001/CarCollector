'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [offlineEarnings, setOfflineEarnings] = useState<{
    income: number
    minutes: number
  } | null>(null)

  useEffect(() => {
    if (localStorage.getItem('token')) router.replace('/auction')
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const body =
        mode === 'signup'
          ? { username, email, password }
          : { email, password }

      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }

      localStorage.setItem('token', data.token)
      localStorage.setItem('username', data.username)

      // Show offline earnings notification before redirecting
      if (mode === 'login' && data.offline_income > 0) {
        setOfflineEarnings({ income: data.offline_income, minutes: data.offline_minutes })
        setTimeout(() => router.push('/auction'), 3000)
      } else {
        router.push('/auction')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Offline earnings screen
  if (offlineEarnings) {
    return (
      <div className="min-h-screen bg-[var(--bg-deep)] flex items-center justify-center p-4">
        <div className="bg-[var(--bg-card-2)] border border-green-500/30 rounded-2xl p-10 text-center max-w-sm w-full shadow-2xl">
          <div className="text-6xl mb-4">💰</div>
          <h2 className="text-2xl font-bold text-white mb-2">Welcome Back!</h2>
          <p className="text-gray-400 text-sm mb-6">
            Your fleet was working while you were away
          </p>
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 mb-6">
            <div className="text-4xl font-bold text-green-400 mb-1">
              +${offlineEarnings.income.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="text-green-300/70 text-sm">
              earned over {offlineEarnings.minutes >= 60
                ? `${Math.floor(offlineEarnings.minutes / 60)}h ${offlineEarnings.minutes % 60}m`
                : `${offlineEarnings.minutes} minutes`} offline
            </div>
          </div>
          <p className="text-gray-500 text-xs">Redirecting to auction...</p>
          <div className="mt-3 h-1 bg-[var(--bg-deep)] rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-[shrink_3s_linear_forwards]" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg-deep)] flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-2">🏎️</div>
          <h1 className="text-3xl font-bold text-white">Car Auction</h1>
          <p className="text-gray-400 mt-1">Simulator</p>
        </div>

        {/* Card */}
        <div className="bg-[var(--bg-card-2)] border border-[var(--border)] rounded-2xl p-8 shadow-2xl">
          {/* Toggle */}
          <div className="flex rounded-xl bg-[var(--bg-deep)] p-1 mb-6">
            <button
              onClick={() => { setMode('login'); setError('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === 'login'
                  ? 'bg-orange-500 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => { setMode('signup'); setError('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === 'signup'
                  ? 'bg-orange-500 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="Your racer name"
                  className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white font-semibold py-3 rounded-lg transition-colors mt-2"
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Start Racing' : 'Create Account'}
            </button>
          </form>

          {mode === 'signup' && (
            <p className="text-center text-gray-500 text-sm mt-4">
              You start with <span className="text-orange-400 font-semibold">$10,000</span> to bid with
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
