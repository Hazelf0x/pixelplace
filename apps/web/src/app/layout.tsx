import './globals.css'
import './studio.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Silkscreen } from 'next/font/google'

// A bitmap face for headings and labels. next/font downloads it at build time and
// self-hosts it, so the deployed site never calls out to Google. Body copy stays a
// normal sans — a pixel face is a voice, not a substitute for readability.
const pixel = Silkscreen({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--pixel',
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'PixelPlace',
  description:
    'Pixel art that is source code. Write it by hand, or hand the tools to your agent over WebMCP — the compiler runs in your browser.'
}

/** The mark is itself pixel art — 8x8, drawn in SVG rects so it scales crisply. */
function BrandMark() {
  const on = [
    [2, 1], [3, 1], [4, 1], [5, 1],
    [1, 2], [6, 2],
    [1, 3], [3, 3], [4, 3], [6, 3],
    [1, 4], [6, 4],
    [1, 5], [2, 5], [5, 5], [6, 5],
    [2, 6], [3, 6], [4, 6], [5, 6]
  ]
  return (
    <svg className="brand-mark" viewBox="0 0 8 8" aria-hidden="true">
      {on.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill={y < 4 ? '#ef7d57' : '#67d7ff'} />
      ))}
    </svg>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixel.variable}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <BrandMark />
            <span>Pixel<em>Place</em></span>
          </Link>
          <Link href="/" className="navlink">Gallery</Link>
          <Link href="/guide" className="navlink">Guide</Link>
          <Link href="/about" className="navlink">How it works</Link>
          <div className="spacer" />
          <Link href="/studio" className="btn primary">Open Studio</Link>
        </header>
        {children}
      </body>
    </html>
  )
}
