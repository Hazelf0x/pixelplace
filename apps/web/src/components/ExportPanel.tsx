'use client'

import { useState } from 'react'

const SCALES = [1, 2, 4, 8, 16]

/**
 * Getting the art out. Plain anchors rather than fetch-and-blob: the export route
 * already sets Content-Disposition, so the browser does the download natively and
 * the link still works with JS disabled.
 */
export default function ExportPanel({
  id,
  animated,
  frameCount,
  width
}: {
  id: string
  animated: boolean
  frameCount: number
  width: number
}) {
  const [scale, setScale] = useState(8)

  // Keep sheets roughly square so a 24-frame strip isn't 2300px wide.
  const columns = animated ? Math.ceil(Math.sqrt(frameCount)) : 1
  const href = (format: string, extra = '') =>
    `/api/posts/${id}/export?format=${format}&scale=${scale}${extra}`

  return (
    <div className="card">
      <h3>Export</h3>

      <div className="scale-picker" role="group" aria-label="Export scale">
        {SCALES.map((s) => (
          <button
            key={s}
            className={`scale-opt${scale === s ? ' active' : ''}`}
            onClick={() => setScale(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="scale-note">
        {width * scale}px wide{animated ? ` · ${columns}×${Math.ceil(frameCount / columns)} sheet` : ''}
      </div>

      <div className="export-links">
        <a className="btn sm" href={href('png')} download>
          PNG{animated ? ' (frame 1)' : ''}
        </a>
        {animated ? (
          <>
            <a className="btn sm" href={href('gif')} download>GIF</a>
            <a className="btn sm" href={href('sheet', `&columns=${columns}`)} download>Sprite sheet</a>
          </>
        ) : null}
        <a className="btn sm" href={href('pc')} download>Source</a>
      </div>

      <p className="hint">
        The <code>.pc</code> source is the only one that round-trips — the images are what it
        compiled to.
      </p>
    </div>
  )
}
