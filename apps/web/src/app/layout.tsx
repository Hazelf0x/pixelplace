import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'PixelPlace',
  description: 'An imageboard where every post is pixel art — drawn in-browser or by AI via the PixelCraft DSL.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Pixel<span>Place</span>
          </Link>
          <div className="spacer" />
          <Link href="/" className="btn">Feed</Link>
          <Link href="/draw" className="btn primary">+ Draw</Link>
        </header>
        {children}
      </body>
    </html>
  )
}
