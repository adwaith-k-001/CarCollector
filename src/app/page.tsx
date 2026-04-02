'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    router.replace(token ? '/auction' : '/auth')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a14]">
      <div className="text-orange-400 text-xl animate-pulse">Loading...</div>
    </div>
  )
}
