'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Diagnostic {
  code: string
  message: string
  line: number
  column: number
  hint?: string
}

interface RenderResponse {
  ok: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
  width: number
  height: number
  hasAnimation: boolean
  frameCount: number
  palette: string[]
  png: string | null
}

interface AnimateResponse {
  ok: boolean
  hasAnimation: boolean
  frameCount: number
  fps: number
  gif: string | null
}

export default function PixelEditor({
  initialSource,
  initialPrompt = '',
  autoDraw = false
}: {
  initialSource: string
  initialPrompt?: string
  autoDraw?: boolean
}) {
  const router = useRouter()
  const [source, setSource] = useState(initialSource)
  const [result, setResult] = useState<RenderResponse | null>(null)
  const [rendering, setRendering] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AI authoring state. `aiSource` is the exact source Claude returned; while the
  // editor still matches it, the work is provably AI-authored. The moment a human
  // edits it, it becomes a human (or collaborative) work — honest provenance.
  const [aiPrompt, setAiPrompt] = useState(initialPrompt)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiSource, setAiSource] = useState<string | null>(null)
  const [aiInfo, setAiInfo] = useState<{ attempts: number; model: string } | null>(null)

  // Animation preview. Playing shows the encoded GIF (the browser loops it for
  // free); pausing swaps to a single server-rendered frame you can scrub.
  const [gif, setGif] = useState<string | null>(null)
  const [encoding, setEncoding] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState(0)
  const [framePng, setFramePng] = useState<string | null>(null)
  const animateSeq = useRef(0)
  const frameSeq = useRef(0)

  const isAiAuthored = aiSource !== null && source === aiSource

  const render = useCallback(async (src: string) => {
    setRendering(true)
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src, scale: 14 })
      })
      const data = (await res.json()) as RenderResponse
      setResult(data)
    } catch {
      // network/transient error — keep the last good preview
    } finally {
      setRendering(false)
    }
  }, [])

  // Live preview: debounce keystrokes, render via the canonical server pipeline.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => render(source), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [source, render])

  const isAnimated = result?.ok === true && result.hasAnimation
  const frameCount = result?.frameCount ?? 0

  // Encode the GIF only once the still render says the program has frames and
  // compiles — no point paying for every frame while the source is mid-keystroke.
  useEffect(() => {
    if (!isAnimated) {
      setGif(null)
      return
    }
    const seq = ++animateSeq.current
    setEncoding(true)
    fetch('/api/animate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, scale: 14 })
    })
      .then((res) => res.json() as Promise<AnimateResponse>)
      .then((data) => {
        // Ignore responses that a newer edit has already superseded.
        if (seq !== animateSeq.current) return
        setGif(data.ok ? data.gif : null)
      })
      .catch(() => {
        if (seq === animateSeq.current) setGif(null)
      })
      .finally(() => {
        if (seq === animateSeq.current) setEncoding(false)
      })
  }, [isAnimated, source])

  // Keep the scrub position inside the program's frame range as it is edited.
  useEffect(() => {
    if (frameCount > 0 && frame > frameCount - 1) setFrame(frameCount - 1)
  }, [frameCount, frame])

  // Paused: fetch the single frame being scrubbed to.
  useEffect(() => {
    if (!isAnimated || playing) return
    const seq = ++frameSeq.current
    fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, scale: 14, frame })
    })
      .then((res) => res.json() as Promise<RenderResponse>)
      .then((data) => {
        if (seq === frameSeq.current) setFramePng(data.png)
      })
      .catch(() => undefined)
  }, [isAnimated, playing, frame, source])

  // What the preview pane actually shows, in priority order.
  const previewSrc = isAnimated
    ? playing
      ? gif ?? result?.png ?? null
      : framePng ?? result?.png ?? null
    : result?.png ?? null

  const canSave = result?.ok === true && !saving

  const handleAiDraw = useCallback(async (promptOverride?: string) => {
    const prompt = (promptOverride ?? aiPrompt).trim()
    if (!prompt || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    setAiInfo(null)
    try {
      const res = await fetch('/api/ai-draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setAiError(data?.error ?? `Claude couldn't make valid pixel art (${data?.attempts ?? '?'} tries)`)
        return
      }
      // Load Claude's source into the editor; live preview re-renders from it.
      setSource(data.source)
      setAiSource(data.source)
      setAiInfo({ attempts: data.attempts, model: data.model })
    } catch {
      setAiError('Network error talking to the AI endpoint')
    } finally {
      setAiBusy(false)
    }
  }, [aiPrompt, aiBusy])

  // Arriving from the gallery with ?prompt=… starts drawing straight away.
  const autoDrawFired = useRef(false)
  useEffect(() => {
    if (!autoDraw || autoDrawFired.current || !initialPrompt.trim()) return
    autoDrawFired.current = true
    void handleAiDraw(initialPrompt)
  }, [autoDraw, initialPrompt, handleAiDraw])

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    const authorType = isAiAuthored ? 'ai' : 'human'
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          title: title.trim() || 'untitled',
          authorType,
          author: isAiAuthored ? `Claude (${aiInfo?.model ?? 'ai'})` : 'anon'
        })
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setSaveError(data?.error ?? 'Could not save')
        return
      }
      router.push(`/p/${data.meta.id}`)
    } catch {
      setSaveError('Network error while saving')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="studio">
      <div className="code-shell">
        <div className="code-head">
          <span>post.pc</span>
          <div className="spacer" />
          <span>{source.split('\n').length} lines</span>
        </div>
        <textarea
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          aria-label="PixelCraft source"
        />
      </div>

      <div className="side">
        <div className="card">
          <h3>Ask Claude</h3>
          <div className="field-row">
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAiDraw()
              }}
              placeholder="a sleepy orange cat"
              disabled={aiBusy}
            />
            <button
              className="btn primary"
              disabled={aiBusy || aiPrompt.trim().length === 0}
              onClick={() => void handleAiDraw()}
            >
              {aiBusy ? 'Drawing…' : 'Draw'}
            </button>
          </div>
          {aiInfo ? (
            <div className="all-good" style={{ marginTop: 10 }}>
              ✓ {aiInfo.model} · {aiInfo.attempts} {aiInfo.attempts === 1 ? 'try' : 'tries'}
            </div>
          ) : null}
          {aiError ? (
            <div className="diag error" style={{ marginTop: 10 }}>
              <span>{aiError}</span>
            </div>
          ) : null}
          <p className="hint">
            Claude writes PixelCraft, reads its own compiler errors, and fixes them until it renders.
          </p>
        </div>

        <div className="card">
          <h3>
            Preview
            {rendering ? <span className="count">rendering…</span> : null}
            {encoding ? <span className="count">encoding…</span> : null}
          </h3>
          <div className="stage">
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="render preview" />
            ) : (
              <span className="placeholder">No render yet</span>
            )}
          </div>

          {isAnimated ? (
            <div className="playback">
              <button
                className="btn icon"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Pause animation' : 'Play animation'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, frameCount - 1)}
                value={frame}
                aria-label="Frame"
                onChange={(e) => {
                  // Scrubbing implies you want to look at one frame, not the loop.
                  setPlaying(false)
                  setFrame(Number(e.target.value))
                }}
              />
              <span className="counter">
                {playing ? `${frameCount}f` : `${frame + 1}/${frameCount}`}
              </span>
            </div>
          ) : null}

          {result ? (
            <div className="rows" style={{ marginTop: 12 }}>
              <div className="row"><span>Canvas</span><b>{result.width}×{result.height}</b></div>
              <div className="row">
                <span>Motion</span>
                <b>{result.hasAnimation ? `${result.frameCount}f` : 'still'}</b>
              </div>
            </div>
          ) : null}
        </div>

        {result && result.palette.length > 0 ? (
          <div className="card">
            <h3>Palette <span className="count">{result.palette.length}</span></h3>
            <div className="swatches">
              {result.palette.map((c, i) => (
                <div key={i} className="swatch" style={{ background: c }} title={c} />
              ))}
            </div>
          </div>
        ) : null}

        <div className="card">
          <h3>Diagnostics</h3>
          {result && result.errors.length === 0 && result.warnings.length === 0 ? (
            <div className="all-good">✓ No issues</div>
          ) : null}
          {result?.errors.map((d, i) => (
            <div key={`e${i}`} className="diag error">
              <span className="code">{d.code}</span>
              <span className="where">{d.line}:{d.column}</span>
              <span>{d.message}</span>
            </div>
          ))}
          {result?.warnings.map((d, i) => (
            <div key={`w${i}`} className="diag warn">
              <span className="code">{d.code}</span>
              <span className="where">{d.line}:{d.column}</span>
              <span>{d.message}{d.hint ? ` (${d.hint})` : ''}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>
            Publish
            {isAiAuthored ? <span className="chip ai">AI</span> : null}
          </h3>
          <div className="field-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              maxLength={120}
            />
            <button className="btn primary" disabled={!canSave} onClick={handleSave}>
              {saving ? 'Saving…' : 'Publish'}
            </button>
          </div>
          {!result?.ok && result ? (
            <p className="hint">Fix the errors above to publish — only valid PixelCraft is stored.</p>
          ) : null}
          {saveError ? (
            <div className="diag error" style={{ marginTop: 10 }}>
              <span>{saveError}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
