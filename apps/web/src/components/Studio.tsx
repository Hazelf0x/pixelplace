'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { renderToRgba, type BrowserRenderResult } from '@pixelplace/pixelcraft/browser'
import { downloadGif, downloadPng, downloadSource, paintToCanvas } from '@/lib/render-client'
import { createStudioTools, type ActivityEntry } from '@/lib/studio-tools'
import { isWebMcpAvailable, registerTools, type RegistrationStatus } from '@/lib/webmcp'
import { loadExampleSource } from '@/lib/gallery'

const STARTER = `canvas 24x24
pal night=#12121c moon=#f4e7c3 glow=#3d5a80 crater=#d8c8a0

rect 0,0 24x24 night
circ 12,12 8 moon
circ 9,10 2 crater
circ 15,15 1 crater
px 6,4 moon
px 19,7 moon
px 4,17 moon
`

const AUTOSAVE_KEY = 'pixelplace.studio.source'

/**
 * The most useful accent in a program's own palette — used to tint the Studio's
 * rules so the frame belongs to the picture inside it.
 *
 * "Most useful" is the most saturated colour that is neither near-black nor
 * near-white, because those are the ones a pixel artist picks to carry meaning;
 * the darks and lights are structure. Returns null for a program with nothing
 * suitable, and the caller falls back to the site's own line colour.
 */
function accentFrom(palette: readonly string[]): string | null {
  let best: { color: string; sat: number } | null = null

  for (const entry of palette) {
    const hex = entry.slice(1, 7)
    if (hex.length !== 6) continue
    const r = parseInt(hex.slice(0, 2), 16) / 255
    const g = parseInt(hex.slice(2, 4), 16) / 255
    const b = parseInt(hex.slice(4, 6), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    if (lightness < 0.22 || lightness > 0.8) continue
    const delta = max - min
    const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
    if (sat < 0.15) continue
    if (!best || sat > best.sat) best = { color: `#${hex}`, sat }
  }

  return best ? best.color : null
}
const MAX_HISTORY = 40

interface SourceHistoryEntry {
  source: string
  action: string
}

export default function Studio() {
  const [source, setSource] = useState(STARTER)
  // The first program is decided on the client — from ?example=, then autosave, then
  // the starter. Until that settles the panes stay empty, so the starter art never
  // flashes on its way to being replaced. The server renders this same empty state,
  // which is what keeps hydration honest.
  const [ready, setReady] = useState(false)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [mcp, setMcp] = useState<RegistrationStatus>({ state: 'unsupported' })
  const [flash, setFlash] = useState<string | null>(null)
  const [past, setPast] = useState<SourceHistoryEntry[]>([])
  const [future, setFuture] = useState<SourceHistoryEntry[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activityId = useRef(0)
  const manualBatchActive = useRef(false)
  const manualBatchTimer = useRef<number | null>(null)
  // Tools register once, so all edits read and write through this ref instead of
  // closing over an old render. Updating it synchronously also means a tool called
  // immediately after another tool sees the new program before React rerenders.
  const live = useRef({ source, frame })
  live.current = { source, frame }

  // Compiling is fast enough in the browser to do on every change, so the preview
  // tracks the source with no debounce and no request.
  const render: BrowserRenderResult = useMemo(() => renderToRgba(source, { frame }), [source, frame])

  // `ready` belongs in the deps, not just `render`. The canvas is not mounted during
  // the first pass — the stage shows a loading line until the opening program is
  // settled — so this effect runs once against a null ref. A visitor whose program
  // then comes from the starter (no autosave, no ?example=) never changes `render`
  // afterwards, so without `ready` the paint would never be retried and they would
  // sit looking at an empty canvas.
  useEffect(() => {
    if (canvasRef.current && render.ok) paintToCanvas(canvasRef.current, render)
  }, [render, ready])

  // The stage's usable content box, so the art can be scaled to fit it exactly.
  // Measured directly rather than through a ResizeObserver: observer callbacks are
  // tied to the rendering lifecycle and never arrive in some embedded/headless
  // contexts, which would silently leave the canvas at its fallback size.
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageBox, setStageBox] = useState({ width: 420, height: 340 })

  useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      if (!stage) return
      const style = window.getComputedStyle(stage)
      const width =
        stage.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')
      const height =
        stage.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0')
      if (width > 0 && height > 0) {
        setStageBox((current) =>
          Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
            ? current
            : { width, height }
        )
      }
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [render.ok])

  // Largest INTEGER upscale that still fits. Letting CSS clamp a too-large canvas
  // would land on a fractional factor, which is exactly what turns pixel art to
  // mush — so the scale is floored against the measured stage instead.
  const displayScale = useMemo(() => {
    if (!render.ok || render.sourceWidth === 0 || render.sourceHeight === 0) return 1
    const fit = Math.min(stageBox.width / render.sourceWidth, stageBox.height / render.sourceHeight)
    return Math.max(1, Math.floor(fit))
  }, [render, stageBox])

  // A loop that sits on frame 0 reads as a still image, so start animated work
  // playing. Only once — after that, playback is whatever the person chose.
  const autoPlayed = useRef(false)
  useEffect(() => {
    if (autoPlayed.current || !render.ok || !render.hasAnimation) return
    autoPlayed.current = true
    setPlaying(true)
  }, [render])

  // Keep the frame in range when the program's length changes underneath it.
  useEffect(() => {
    if (render.ok && render.hasAnimation && frame >= render.frameCount) setFrame(0)
    if (render.ok && !render.hasAnimation && frame !== 0) setFrame(0)
  }, [render, frame])

  useEffect(() => {
    if (!playing || !render.ok || !render.hasAnimation) return
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % Math.max(1, render.frameCount))
    }, 1000 / 12)
    return () => window.clearInterval(timer)
  }, [playing, render.ok, render.hasAnimation, render.frameCount])

  // Decide the opening program. A ?example= link wins over autosave, because asking
  // for a specific piece is a clearer intent than "whatever I had open last time".
  //
  // This runs in a LAYOUT effect so the no-example paths settle before the browser
  // paints; only a gallery link, which has to fetch, shows a loading beat.
  useLayoutEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('example')
    if (!slug) {
      try {
        const saved = window.localStorage.getItem(AUTOSAVE_KEY)
        if (saved) setSource(saved)
      } catch {
        // Private windows and blocked site data are fine; the starter stands in.
      }
      setReady(true)
      return
    }

    let cancelled = false
    loadExampleSource(slug).then((loaded) => {
      if (cancelled) return
      // An unknown slug just opens the studio on the starter program.
      if (loaded) setSource(loaded)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the work saved. This is the whole of our persistence story: the program is
  // the document, so one string is the save file. Gated on `ready` so the starter is
  // never written over the saved program in the moment before it is restored.
  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(AUTOSAVE_KEY, source)
    } catch {
      // Not being able to autosave must never break editing.
    }
  }, [source, ready])

  const log = useCallback((tool: string, detail: string, succeeded: boolean) => {
    setActivity((entries) =>
      [{ id: activityId.current++, tool, detail, at: Date.now(), ok: succeeded }, ...entries].slice(0, 60)
    )
  }, [])

  const finishManualBatch = useCallback(() => {
    if (manualBatchTimer.current !== null) window.clearTimeout(manualBatchTimer.current)
    manualBatchTimer.current = null
    manualBatchActive.current = false
  }, [])

  useEffect(() => () => finishManualBatch(), [finishManualBatch])

  /** Apply a discrete revision from an agent or example, preserving the prior source. */
  const applySource = useCallback(
    (next: string, action: string) => {
      const current = live.current.source
      if (next === current) return
      finishManualBatch()
      setPast((entries) => [...entries, { source: current, action }].slice(-MAX_HISTORY))
      setFuture([])
      live.current = { ...live.current, source: next }
      setSource(next)
    },
    [finishManualBatch]
  )

  /** Group a person's continuous typing into one undoable hand-edit revision. */
  const editSourceByHand = useCallback((next: string) => {
    const current = live.current.source
    if (next === current) return

    if (!manualBatchActive.current) {
      manualBatchActive.current = true
      setPast((entries) => [...entries, { source: current, action: 'Hand edit' }].slice(-MAX_HISTORY))
      setFuture([])
    }

    live.current = { ...live.current, source: next }
    setSource(next)
    if (manualBatchTimer.current !== null) window.clearTimeout(manualBatchTimer.current)
    manualBatchTimer.current = window.setTimeout(() => {
      manualBatchActive.current = false
      manualBatchTimer.current = null
    }, 800)
  }, [])

  const undoSource = useCallback(() => {
    const previous = past[past.length - 1]
    if (!previous) return
    finishManualBatch()
    const current = live.current.source
    setPast(past.slice(0, -1))
    setFuture((entries) => [...entries, { source: current, action: previous.action }].slice(-MAX_HISTORY))
    live.current = { ...live.current, source: previous.source }
    setSource(previous.source)
  }, [finishManualBatch, past])

  const redoSource = useCallback(() => {
    const next = future[future.length - 1]
    if (!next) return
    finishManualBatch()
    const current = live.current.source
    setFuture(future.slice(0, -1))
    setPast((entries) => [...entries, { source: current, action: next.action }].slice(-MAX_HISTORY))
    live.current = { ...live.current, source: next.source }
    setSource(next.source)
  }, [finishManualBatch, future])

  const undoAction = past[past.length - 1]?.action
  const redoAction = future[future.length - 1]?.action

  const exportArtwork = useCallback(
    async (format: 'png' | 'gif' | 'source', scale: number): Promise<string> => {
      const current = live.current.source
      const name = 'pixelplace'
      if (format === 'source') return downloadSource(current, name)
      if (format === 'gif') return downloadGif(current, scale, 12, name)
      return downloadPng(current, scale, live.current.frame, name)
    },
    []
  )

  useEffect(() => {
    const controller = new AbortController()
    const tools = createStudioTools(
      {
        getSource: () => live.current.source,
        setSource: applySource,
        getFrame: () => live.current.frame,
        setFrame: (next) => setFrame(next),
        setPlaying: (next) => setPlaying(next),
        exportArtwork
      },
      log
    )

    registerTools(tools, controller.signal).then(setMcp)
    return () => controller.abort()
  }, [applySource, exportArtwork, log])

  const runExport = async (format: 'png' | 'gif' | 'source') => {
    try {
      const filename = await exportArtwork(format, 8)
      setFlash(`Saved ${filename}`)
    } catch (error) {
      setFlash(error instanceof Error ? error.message : String(error))
    }
    window.setTimeout(() => setFlash(null), 3200)
  }

  // Re-derived on every keystroke, because the palette is a property of the program
  // and the program changes as it is written.
  const tint = useMemo(() => (render.ok ? accentFrom(render.palette) : null), [render])

  const errors = render.errors
  const warnings = render.warnings

  return (
    <main className="studio" style={tint ? ({ '--tint': tint } as React.CSSProperties) : undefined}>
      <section className="editor-pane">
        <div className="pane-head">
          <h2>Source</h2>
          <div className="editor-head-actions">
            <span className="pane-note">
              {render.ok
                ? `${render.sourceWidth}×${render.sourceHeight}${render.hasAnimation ? ` · ${render.frameCount} frames` : ''}`
                : `${errors.length} error${errors.length === 1 ? '' : 's'}`}
            </span>
            <div className="history-controls" aria-label="Source history">
              <button
                className="btn small ghost"
                onClick={undoSource}
                disabled={!undoAction}
                title={undoAction ? `Undo ${undoAction.toLowerCase()}` : 'Nothing to undo'}
              >
                Undo
              </button>
              <button
                className="btn small ghost"
                onClick={redoSource}
                disabled={!redoAction}
                title={redoAction ? `Redo ${redoAction.toLowerCase()}` : 'Nothing to redo'}
              >
                Redo
              </button>
              <Link href="/guide" className="btn small ghost">
                Guide
              </Link>
            </div>
          </div>
        </div>
        <textarea
          className="source"
          value={ready ? source : ''}
          readOnly={!ready}
          spellCheck={false}
          onChange={(event) => editSourceByHand(event.target.value)}
          aria-label="PixelCraft source"
        />
        <div className="diagnostics">
          {errors.map((e, i) => (
            <p key={`e${i}`} className="diag error">
              <code>{e.code}</code>
              <span className="where">
                {e.line}:{e.column}
              </span>
              {e.message}
            </p>
          ))}
          {errors.length === 0 &&
            warnings.map((w, i) => (
              <p key={`w${i}`} className="diag warn">
                <code>{w.code}</code>
                <span className="where">{w.line}</span>
                {w.message}
              </p>
            ))}
          {errors.length === 0 && warnings.length === 0 && (
            <p className="diag clean">Compiles clean.</p>
          )}
        </div>
      </section>

      <section className="canvas-pane">
        <div className="pane-head">
          <h2>Canvas</h2>
          {render.ok && render.hasAnimation && (
            <div className="transport">
              <button className="btn small" onClick={() => setPlaying((p) => !p)}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, render.frameCount - 1)}
                value={frame}
                onChange={(event) => {
                  setPlaying(false)
                  setFrame(Number(event.target.value))
                }}
                aria-label="Frame"
              />
              <span className="pane-note">
                {frame + 1}/{render.frameCount}
              </span>
            </div>
          )}
        </div>

        <div className="stage" ref={stageRef}>
          {!ready ? (
            <p className="stage-empty">Loading…</p>
          ) : render.ok ? (
            // Rendered at native size and scaled up by an INTEGER factor in CSS, so
            // every source pixel stays a crisp square block. Fractional scaling is
            // what makes pixel art look muddy, so it never happens here.
            <canvas
              ref={canvasRef}
              className="art"
              style={{ width: `${render.sourceWidth * displayScale}px` }}
            />
          ) : (
            <p className="stage-empty">Nothing to draw yet — fix the errors on the left.</p>
          )}
        </div>

        {render.ok && render.palette.length > 0 && (
          <div className="palette">
            {render.palette.map((color, i) => (
              <span key={i} className="swatch" style={{ background: color }} title={color} />
            ))}
          </div>
        )}

        <div className="exports">
          <button className="btn small" onClick={() => runExport('png')}>
            PNG
          </button>
          <button className="btn small" onClick={() => runExport('gif')} disabled={!render.hasAnimation}>
            GIF
          </button>
          <button className="btn small" onClick={() => runExport('source')}>
            .pc source
          </button>
          {flash && <span className="flash">{flash}</span>}
        </div>
      </section>

      <AgentPanel
        status={mcp}
        activity={activity}
        onLoadExample={async (slug) => {
          const loaded = await loadExampleSource(slug)
          if (loaded) {
            applySource(loaded, 'Example load')
            setFrame(0)
            setPlaying(true)
          }
        }}
      />
    </main>
  )
}

function AgentPanel({
  status,
  activity,
  onLoadExample
}: {
  status: RegistrationStatus
  activity: ActivityEntry[]
  onLoadExample: (slug: string) => void
}) {
  // Detected in an effect, not during render: the server always renders "no agent",
  // so probing during the first client render is a guaranteed hydration mismatch.
  const [available, setAvailable] = useState(false)
  useEffect(() => setAvailable(isWebMcpAvailable()), [])

  const registered = status.state === 'registered'
  const connecting = available && status.state === 'unsupported'

  return (
    <section className="agent-pane">
      <div className="pane-head">
        <h2>Agent</h2>
        <span
          className={`mcp-dot ${registered ? 'on' : connecting ? 'pending' : 'off'}`}
          aria-hidden="true"
        />
      </div>

      {registered ? (
        <>
          <p className="agent-lead">
            <strong>{status.tools.length} tools</strong> are live on this page. Ask your agent to draw
            something — it writes the program, the canvas shows you the result.
          </p>
          <ul className="tool-list">
            {status.tools.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <div className="collaboration-card">
            <div className="eyebrow">Create together</div>
            <p>
              <strong>You art-direct.</strong> Describe, judge, and steer. You never need to write
              code—but the source is yours to edit whenever you want direct control.
            </p>
            <ol className="collaboration-steps">
              <li><span>1</span>Ask for a scene, sprite, icon set, or animation.</li>
              <li><span>2</span>Judge the canvas and say what should change.</li>
              <li><span>3</span>Undo any revision, or edit a line and let the agent continue.</li>
            </ol>
            <div className="prompt-starters" aria-label="Prompt ideas">
              <code>Draw a 32×32 forest shrine with a four-frame fire.</code>
              <code>Keep the composition. Make the palette colder.</code>
              <code>Read my hand edit, then add a sparkle loop.</code>
            </div>
            <Link href="/guide" className="guide-link">
              Learn enough PixelCraft to tweak it yourself →
            </Link>
          </div>
        </>
      ) : (
        <div className="agent-lead">
          <p>
            {status.state === 'failed'
              ? 'WebMCP is present, but the Studio tools could not be registered.'
              : connecting
                ? 'WebMCP detected. Connecting the Studio tools…'
                : 'No agent connected. This page is a normal pixel editor without one.'}
          </p>
          {!connecting && status.state !== 'failed' && (
            <p className="agent-hint">
              To connect: open this page in ChatGPT&apos;s in-app browser, or in Chrome with{' '}
              <code>chrome://flags/#enable-webmcp-testing</code> enabled.
            </p>
          )}
          {status.state === 'failed' && <p className="diag error">{status.error}</p>}
        </div>
      )}

      <div className="pane-head">
        <h2>Activity</h2>
      </div>
      {activity.length === 0 ? (
        <p className="agent-hint">
          Nothing yet. Every tool call your agent makes shows up here, so you can watch it work.
        </p>
      ) : (
        <ol className="activity">
          {activity.map((entry) => (
            <li key={entry.id} className={entry.ok ? '' : 'failed'}>
              <code>{entry.tool}</code>
              <span>{entry.detail}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="pane-head">
        <h2>Study an example</h2>
      </div>
      <div className="quick-examples">
        {['opus5_deep_field', 'fable_ink_sea_v2', 'ritual_vfx_loop', 'icon_sheet_basics'].map((slug) => (
          <button key={slug} className="btn small ghost" onClick={() => onLoadExample(slug)}>
            {slug.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
    </section>
  )
}
