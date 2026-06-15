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

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, title: title.trim() || 'untitled' })
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
          <h3>Post it</h3>
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
