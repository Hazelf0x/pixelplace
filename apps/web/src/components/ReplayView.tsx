'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface ReplayStep {
  index: number
  line: number
  column: number
  text: string
  png: string
}

interface ReplayResponse {
  ok: boolean
  steps: ReplayStep[]
  truncated: boolean
  errors: { code: string; message: string; line: number; column: number }[]
}

/** Milliseconds per construction step during playback. */
const STEP_MS = 260

/**
 * Watch a piece being drawn, statement by statement, from its own source.
 *
 * This is the thing a bitmap gallery cannot do: because the work is stored as a
 * program, the program can be re-run partway and rendered. The code pane tracks
 * the canvas — whichever line is highlighted is the line that produced what you
 * are looking at.
 */
export default function ReplayView({ source, id }: { source: string; id: string }) {
  const [steps, setSteps] = useState<ReplayStep[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const lineRef = useRef<HTMLDivElement | null>(null)

  const sourceLines = source.split(/\r?\n/)

  // Fetch once per work. Replay is only built when someone actually asks to see it.
  useEffect(() => {
    let cancelled = false
    fetch('/api/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, scale: 10 })
    })
      .then((res) => res.json() as Promise<ReplayResponse>)
      .then((data) => {
        if (cancelled) return
        if (!data.ok || data.steps.length === 0) {
          setError(data.errors?.[0]?.message ?? 'This program produced no visible steps.')
          return
        }
        setSteps(data.steps)
        setStep(0)
        setPlaying(true)
      })
      .catch(() => {
        if (!cancelled) setError('Could not build the replay.')
      })
    return () => {
      cancelled = true
    }
  }, [source, id])

  // Advance playback. Stops at the end rather than looping — the finished piece
  // is the point, and a loop would keep wiping it away.
  useEffect(() => {
    if (!playing || !steps) return
    if (step >= steps.length - 1) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, step, steps])

  // Keep the active line visible as the replay walks down the program.
  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [step])

  const restart = useCallback(() => {
    setStep(0)
    setPlaying(true)
  }, [])

  if (error) {
    return <div className="replay-loading">{error}</div>
  }
  if (!steps) {
    return <div className="replay-loading">Building replay…</div>
  }

  const current = steps[Math.min(step, steps.length - 1)]
  const atEnd = step >= steps.length - 1

  return (
    <div>
      <div className="replay-split">
        <div className="stage post-stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.png} alt={`Step ${step + 1}`} />
        </div>

        <div className="replay-code">
          <div className="replay-now">{current.text || '—'}</div>
          <div className="source">
            {sourceLines.map((text, i) => {
              const isCurrent = i + 1 === current.line
              return (
                <div
                  key={i}
                  ref={isCurrent ? lineRef : undefined}
                  className={`ln${isCurrent ? ' hot' : ''}`}
                >
                  <span className="num">{i + 1}</span>
                  <span>{text || ' '}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="playback">
        <button
          className="btn icon"
          onClick={() => (atEnd && !playing ? restart() : setPlaying((p) => !p))}
          aria-label={atEnd && !playing ? 'Replay from the start' : playing ? 'Pause replay' : 'Play replay'}
        >
          {atEnd && !playing ? '↺' : playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          value={step}
          aria-label="Construction step"
          onChange={(e) => {
            setPlaying(false)
            setStep(Number(e.target.value))
          }}
        />
        <span className="counter">
          {step + 1}/{steps.length}
        </span>
      </div>
    </div>
  )
}
