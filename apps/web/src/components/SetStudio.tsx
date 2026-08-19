'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface PlanColor {
  name: string
  hex: string
}

interface Member {
  name: string
  brief: string
  ok: boolean
  source: string
  attempts: number
  errors: { code: string; message: string; line: number; column: number }[]
  png: string | null
  offPalette: string[]
}

interface SetResult {
  ok: boolean
  plan: { title: string; canvas: string; palette: PlanColor[] }
  members: Member[]
  model: string
  calls: number
  error?: string
}

const SIZES = [2, 4, 6, 8, 9, 12]

export default function SetStudio() {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SetResult | null>(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const generate = async () => {
    const value = prompt.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/ai-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: value, count })
      })
      const data = (await res.json()) as SetResult
      if (!res.ok || data.error) {
        setError(data.error ?? 'Set generation failed')
        return
      }
      setResult(data)
      setTitle(data.plan.title)
    } catch {
      setError('Network error talking to the set endpoint')
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (!result || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || result.plan.title,
          canvas: result.plan.canvas,
          palette: result.plan.palette.map((c) => c.hex),
          authorType: 'ai',
          author: `Claude (${result.model})`,
          // Only members that actually rendered can be stored.
          members: result.members.filter((m) => m.ok).map((m) => ({ name: m.name, source: m.source }))
        })
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data?.error ?? 'Could not publish the set')
        return
      }
      router.push(`/s/${data.meta.id}`)
    } catch {
      setError('Network error while publishing')
    } finally {
      setSaving(false)
    }
  }

  const good = result?.members.filter((m) => m.ok).length ?? 0

  return (
    <div>
      <div className="card set-form">
        <h3>Describe the set</h3>
        <div className="field-row">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void generate()
            }}
            placeholder="RPG inventory icons: potion, sword, shield, coin"
            disabled={busy}
          />
          <button className="btn primary" disabled={busy || prompt.trim().length === 0} onClick={generate}>
            {busy ? 'Drawing…' : 'Generate set'}
          </button>
        </div>

        <div className="set-count">
          <span className="set-count-label">Pieces</span>
          <div className="scale-picker">
            {SIZES.map((n) => (
              <button
                key={n}
                className={`scale-opt${count === n ? ' active' : ''}`}
                disabled={busy}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <p className="hint">
          Claude plans one shared palette, then draws every piece against it in parallel. Each
          piece is checked against the pixels it actually painted — a stray color is sent back
          with the exact offending hex.
        </p>
        {error ? <div className="diag error" style={{ marginTop: 10 }}><span>{error}</span></div> : null}
      </div>

      {busy ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="replay-loading">
            Planning the palette, then drawing {count} pieces at once…
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="set-review">
          <div className="card">
            <h3>
              Shared palette <span className="count">{result.plan.palette.length}</span>
            </h3>
            <div className="swatches">
              {result.plan.palette.map((c) => (
                <div key={c.name} className="swatch" style={{ background: c.hex }} title={`${c.name} ${c.hex}`} />
              ))}
            </div>
            <div className="rows" style={{ marginTop: 12 }}>
              <div className="row"><span>Canvas</span><b>{result.plan.canvas}</b></div>
              <div className="row"><span>Clean</span><b>{good}/{result.members.length}</b></div>
              <div className="row"><span>Model calls</span><b>{result.calls}</b></div>
            </div>
          </div>

          <div className="set-grid">
            {result.members.map((m, i) => (
              <div key={i} className={`set-member${m.ok ? '' : ' failed'}`}>
                <div className="work-art">
                  {m.png ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.png} alt={m.name} />
                  ) : (
                    <span className="placeholder">no render</span>
                  )}
                </div>
                <div className="work-body">
                  <div className="work-title">{m.name}</div>
                  <div className="work-meta">
                    {m.ok ? (
                      <span className="chip human">{m.attempts} {m.attempts === 1 ? 'try' : 'tries'}</span>
                    ) : (
                      <span className="chip failed-chip">failed</span>
                    )}
                    {m.offPalette.length > 0 ? <span>{m.offPalette.length} off-palette</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Publish set</h3>
            <div className="field-row">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Set title" />
              <button className="btn primary" disabled={saving || good === 0} onClick={publish}>
                {saving ? 'Saving…' : `Publish ${good} pieces`}
              </button>
            </div>
            {good < result.members.length ? (
              <p className="hint">
                {result.members.length - good} piece(s) never rendered cleanly and will be left out —
                only valid PixelCraft is stored.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
