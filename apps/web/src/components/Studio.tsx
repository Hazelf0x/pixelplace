'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activityId = useRef(0)

  // Compiling is fast enough in the browser to do on every change, so the preview
  // tracks the source with no debounce and no request.
  const render: BrowserRenderResult = useMemo(() => renderToRgba(source, { frame }), [source, frame])

  useEffect(() => {
    if (canvasRef.current && render.ok) paintToCanvas(canvasRef.current, render)
  }, [render])

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

  // Tools are registered once, but must always act on current state — so they read
  // and write through this ref rather than closing over a stale render's values.
  const live = useRef({ source, frame })
  live.current = { source, frame }

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
        setSource: (next) => setSource(next),
        getFrame: () => live.current.frame,
        setFrame: (next) => setFrame(next),
        setPlaying: (next) => setPlaying(next),
        exportArtwork
      },
      log
    )

    registerTools(tools, controller.signal).then(setMcp)
    return () => controller.abort()
  }, [exportArtwork, log])

  const runExport = async (format: 'png' | 'gif' | 'source') => {
    try {
      const filename = await exportArtwork(format, 8)
      setFlash(`Saved ${filename}`)
    } catch (error) {
      setFlash(error instanceof Error ? error.message : String(error))
    }
    window.setTimeout(() => setFlash(null), 3200)
  }

  const errors = render.errors
  const warnings = render.warnings

  return (
    <main className="studio">
      <section className="editor-pane">
        <div className="pane-head">
          <h2>Source</h2>
          <span className="pane-note">
            {render.ok
              ? `${render.sourceWidth}×${render.sourceHeight}${render.hasAnimation ? ` · ${render.frameCount} frames` : ''}`
              : `${errors.length} error${errors.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <textarea
          className="source"
          value={ready ? source : ''}
          readOnly={!ready}
          spellCheck={false}
          onChange={(event) => setSource(event.target.value)}
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
            setSource(loaded)
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

  return (
    <section className="agent-pane">
      <div className="pane-head">
        <h2>Agent</h2>
        <span className={`mcp-dot ${status.state === 'registered' ? 'on' : 'off'}`} aria-hidden="true" />
      </div>

      {status.state === 'registered' ? (
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
        </>
      ) : (
        <div className="agent-lead">
          <p>
            {available
              ? 'WebMCP is present but registration did not complete.'
              : 'No agent connected. This page is a normal pixel editor without one.'}
          </p>
          <p className="agent-hint">
            To connect: open this page in ChatGPT&apos;s in-app browser, or in Chrome with{' '}
            <code>chrome://flags/#enable-webmcp-testing</code> enabled.
          </p>
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
        <h2>Try one</h2>
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
