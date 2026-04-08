import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Car Auction Simulator',
  description: 'Bid on rare cars and build your dream garage',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>{children}</body>
    </html>
  )
}
