'use client'
import Link from 'next/link'

export type ActivePage = 'auction' | 'garage' | 'leaderboard' | 'junkyard' | 'trade' | 'account'

interface NavBarProps {
  activePage: ActivePage
  username?: string
  balance?: number
  onLogout: () => void
}

const NAV_ITEMS: { page: ActivePage; label: string; href: string; icon: string }[] = [
  { page: 'auction',     label: 'Auction',     href: '/auction',     icon: '🔨' },
  { page: 'garage',      label: 'Garage',      href: '/garage',      icon: '🚗' },
  { page: 'leaderboard', label: 'Board',       href: '/leaderboard', icon: '🏆' },
  { page: 'junkyard',    label: 'Junkyard',    href: '/junkyard',    icon: '♻️' },
  { page: 'trade',       label: 'Trade',       href: '/trade',       icon: '🤝' },
  { page: 'account',     label: 'Account',     href: '/account',     icon: '👤' },
]

export default function NavBar({ activePage, username, balance, onLogout }: NavBarProps) {
  return (
    <>
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <nav className="border-b border-[#2a2a3e] bg-[#0d0d1a]/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-2">

          {/* Brand */}
          <span className="text-lg font-bold text-white shrink-0">🏎️ CarAuction</span>

          {/* Desktop nav links — hidden on mobile */}
          <div className="hidden md:flex gap-1 flex-1 justify-center">
            {NAV_ITEMS.map(({ page, label, href }) => (
              <Link
                key={page}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activePage === page
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Right: user info */}
          <div className="flex items-center gap-2 shrink-0">
            {username && (
              <div className="text-right hidden sm:block">
                <div className="text-xs text-gray-500 leading-none mb-0.5">{username}</div>
                {balance !== undefined && (
                  <div className="text-sm font-bold text-green-400 leading-none">
                    ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                )}
              </div>
            )}
            {balance !== undefined && (
              <div className="sm:hidden text-sm font-bold text-green-400">
                ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            )}
            <button
              onClick={onLogout}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile bottom tab bar ────────────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0d0d1a]/95 backdrop-blur-sm border-t border-[#2a2a3e]">
        <div className="flex">
          {NAV_ITEMS.map(({ page, label, href, icon }) => (
            <Link
              key={page}
              href={href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-center transition-colors ${
                activePage === page
                  ? 'text-orange-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <span className="text-xl leading-none">{icon}</span>
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
