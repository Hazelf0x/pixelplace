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

export default function PixelEditor({ initialSource }: { initialSource: string }) {
  const router = useRouter()
  const [source, setSource] = useState(initialSource)
  const [result, setResult] = useState<RenderResponse | null>(null)
  const [rendering, setRendering] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AI authoring state. `aiSource` is the exact source Claude returned; while the
  // editor still matches it, the post is provably AI-authored. The moment a human
  // edits it, it becomes a human (or collaborative) post — honest provenance.
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiSource, setAiSource] = useState<string | null>(null)
  const [aiInfo, setAiInfo] = useState<{ attempts: number; model: string } | null>(null)

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

  const canSave = result?.ok === true && !saving

  const handleAiDraw = async () => {
    const prompt = aiPrompt.trim()
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
  }

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
      router.push('/')
    } catch {
      setSaveError('Network error while saving')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="editor">
      <div className="code-pane">
        <textarea
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          aria-label="PixelCraft source"
        />
      </div>

      <div className="side">
        <div className="card">
          <h3>Ask AI to draw</h3>
          <div className="save-row">
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAiDraw() }}
              placeholder="e.g. a sleepy orange cat"
              disabled={aiBusy}
            />
            <button className="btn primary" disabled={aiBusy || aiPrompt.trim().length === 0} onClick={handleAiDraw}>
              {aiBusy ? 'Drawing…' : 'Generate'}
            </button>
          </div>
          {aiInfo ? (
            <div className="all-good" style={{ marginTop: 8 }}>
              ✓ Drawn by {aiInfo.model} in {aiInfo.attempts} {aiInfo.attempts === 1 ? 'try' : 'tries'} — edit it below to make it yours.
            </div>
          ) : null}
          {aiError ? <div className="diag error" style={{ marginTop: 8 }}>{aiError}</div> : null}
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
            Claude writes PixelCraft, then fixes its own compiler errors until it renders.
          </div>
        </div>

        <div className="card">
          <h3>Preview {rendering ? '· rendering…' : ''}</h3>
          <div className="preview-wrap">
            {result?.png ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.png} alt="render preview" />
            ) : (
              <span style={{ color: 'var(--muted)' }}>No render yet</span>
            )}
          </div>
          {result ? (
            <>
              <div className="meta-row"><span>Canvas</span><b>{result.width}×{result.height}</b></div>
              <div className="meta-row"><span>Frames</span><b>{result.hasAnimation ? result.frameCount : 1}</b></div>
            </>
          ) : null}
        </div>

        {result && result.palette.length > 0 ? (
          <div className="card">
            <h3>Palette · {result.palette.length}</h3>
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
              <span className="code">{d.code}</span> {d.line}:{d.column} — {d.message}
            </div>
          ))}
          {result?.warnings.map((d, i) => (
            <div key={`w${i}`} className="diag warn">
              <span className="code">{d.code}</span> {d.line}:{d.column} — {d.message}
              {d.hint ? ` (${d.hint})` : ''}
            </div>
          ))}
        </div>

        <div className="card">
          <h3>Post it {isAiAuthored ? <span className="tag ai">AI</span> : null}</h3>
          <div className="save-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              maxLength={120}
            />
            <button className="btn primary" disabled={!canSave} onClick={handleSave}>
              {saving ? 'Saving…' : 'Post'}
            </button>
          </div>
          {!result?.ok && result ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
              Fix the errors above to post.
            </div>
          ) : null}
          {saveError ? (
            <div className="diag error" style={{ marginTop: 8 }}>{saveError}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
