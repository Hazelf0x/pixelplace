'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The front door. Typing a description here hands off to the studio, which picks
 * the prompt up from the query string and starts drawing immediately — so the
 * first thing a visitor does is watch Claude write PixelCraft, not read about it.
 */
export default function PromptLauncher() {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')

  const launch = () => {
    const value = prompt.trim()
    if (!value) return
    router.push(`/draw?prompt=${encodeURIComponent(value)}`)
  }

  return (
    <div className="prompt-bar">
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') launch()
        }}
        placeholder="a campfire at night, flames flickering…"
        aria-label="Describe something for Claude to draw"
      />
      <button className="btn primary" onClick={launch} disabled={prompt.trim().length === 0}>
        Draw it
      </button>
    </div>
  )
}
