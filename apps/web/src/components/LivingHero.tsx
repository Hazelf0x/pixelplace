'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { renderReplayToRgba } from '@pixelplace/pixelcraft/browser'
import { highlight } from '@/lib/highlight'

/**
 * The front page's argument, running.
 *
 * "Pixel art that is source code" is a claim you can read, or a thing you can
 * watch happen. This replays a real program from the gallery one visible change at
 * a time: the listing scrolls to the statement being executed, and the canvas shows
 * the picture as it stood immediately after it ran.
 *
 * Nothing here is a mock-up or a recording. The steps come from the same compiler
 * and interpreter the Studio uses, computed in the browser on mount — which is only
 * possible because a program is small enough to replay in a few milliseconds, which
 * is itself the point being made.
 */
export default function LivingHero({ source, title, slug }: { source: string; title: string; slug: string }) {
  const replay = useMemo(() => renderReplayToRgba(source), [source])
  const lines = useMemo(() => highlight(source), [source])

  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const listingRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  const steps = replay.steps
  const current = steps[Math.min(step, steps.length - 1)]
  const activeLine = current?.line ?? 0

  // Autoplay once, and only for people who have not asked motion to stop.
  useEffect(() => {
    if (steps.length === 0) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches) {
      setStep(steps.length - 1)
      return
    }
    const start = window.setTimeout(() => setPlaying(true), 400)
    return () => window.clearTimeout(start)
  }, [steps.length])

  useEffect(() => {
    if (!playing || steps.length === 0) return
    const timer = window.setInterval(() => {
      setStep((n) => {
        if (n >= steps.length - 1) {
          setPlaying(false)
          return n
        }
        return n + 1
      })
    }, 90)
    return () => window.clearInterval(timer)
  }, [playing, steps.length])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !current) return
    canvas.width = replay.width
    canvas.height = replay.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(current.rgba), replay.width, replay.height),
      0,
      0
    )
  }, [current, replay.width, replay.height])

  // Keep the executing line in view. `block: 'center'` rather than 'nearest' so the
  // listing reads as travelling through the program instead of jumping to its edges.
  useEffect(() => {
    const active = activeRef.current
    const listing = listingRef.current
    if (!active || !listing) return
    const target = active.offsetTop - listing.clientHeight / 2 + active.clientHeight / 2
    listing.scrollTo({ top: Math.max(0, target), behavior: playing ? 'smooth' : 'auto' })
  }, [activeLine, playing])

  if (!replay.ok || steps.length === 0) {
    // The hero is decoration over substance; if the program will not replay, the
    // page is still a page. Nothing below depends on this having rendered.
    return null
  }

  const progress = steps.length > 1 ? step / (steps.length - 1) : 1

  return (
    <section className="living" aria-label={`${title}, drawing itself`}>
      <div className="living-panes">
        <div className="living-listing" ref={listingRef}>
          <pre>
            <code>
              {lines.map((spans, index) => {
                const lineNumber = index + 1
                const isActive = lineNumber === activeLine
                // Dim what has not run yet. The program is not being typed — it is
                // being executed — so the honest signal is "reached", not "written".
                const reached = lineNumber <= activeLine
                return (
                  <div
                    key={index}
                    ref={isActive ? activeRef : undefined}
                    className={`living-line${isActive ? ' is-active' : ''}${reached ? '' : ' is-ahead'}`}
                  >
                    <span className="living-gutter">{lineNumber}</span>
                    <span className="living-code">
                      {spans.map((span, i) =>
                        span.kind === 'color' ? (
                          <span key={i} className="tok-color" style={{ color: span.swatch }}>
                            {span.text}
                          </span>
                        ) : span.kind === 'plain' ? (
                          <span key={i}>{span.text}</span>
                        ) : (
                          <span key={i} className={`tok-${span.kind}`}>
                            {span.text}
                          </span>
                        )
                      )}
                    </span>
                  </div>
                )
              })}
            </code>
          </pre>
        </div>

        <div className="living-stage">
          <canvas ref={canvasRef} className="living-art" />
        </div>
      </div>

      <div className="living-transport">
        <button
          className="btn sm"
          onClick={() => {
            if (step >= steps.length - 1) setStep(0)
            setPlaying((p) => !p)
          }}
        >
          {playing ? 'pause' : step >= steps.length - 1 ? 'replay' : 'play'}
        </button>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          value={step}
          onChange={(event) => {
            setPlaying(false)
            setStep(Number(event.target.value))
          }}
          aria-label="Replay step"
        />
        <span className="living-count">
          {step + 1}/{steps.length}
        </span>
      </div>

      <p className="living-caption">
        <span className="living-progress" style={{ width: `${Math.round(progress * 100)}%` }} />
        <code>{current.text || '—'}</code>
        <Link href={`/studio?example=${slug}`} className="living-open">
          open {title} in the studio →
        </Link>
      </p>
    </section>
  )
}
