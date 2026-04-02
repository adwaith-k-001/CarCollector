/**
 * Calls the logout API to record last_logout time, then clears local auth state.
 * Always resolves — never throws.
 */
export async function callLogoutAPI(): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  if (!token) return

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      // keepalive ensures the request completes even if the page unloads
      keepalive: true,
    })
  } catch {
    // Best-effort — don't block logout on network failure
  }
}

export function clearAuthStorage(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem('token')
  localStorage.removeItem('username')
}
