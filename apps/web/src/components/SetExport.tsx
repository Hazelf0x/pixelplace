'use client'

import { useState } from 'react'

const SCALES = [1, 2, 4, 8, 16]

/** Export the whole set as one tiled sheet, at a chosen scale and grid width. */
export default function SetExport({ id, memberCount }: { id: string; memberCount: number }) {
  const [scale, setScale] = useState(8)
  const [columns, setColumns] = useState(Math.min(memberCount, Math.ceil(Math.sqrt(memberCount))))

  const rows = Math.ceil(memberCount / columns)
  const columnOptions = Array.from({ length: memberCount }, (_, i) => i + 1).filter(
    (n) => memberCount % n === 0 || n === memberCount
  )

  return (
    <div className="card">
      <h3>Export set</h3>

      <div className="scale-picker" role="group" aria-label="Export scale">
        {SCALES.map((s) => (
          <button key={s} className={`scale-opt${scale === s ? ' active' : ''}`} onClick={() => setScale(s)}>
            {s}×
          </button>
        ))}
      </div>

      <div className="set-count" style={{ marginTop: 8 }}>
        <span className="set-count-label">Columns</span>
        <div className="scale-picker">
          {columnOptions.map((n) => (
            <button key={n} className={`scale-opt${columns === n ? ' active' : ''}`} onClick={() => setColumns(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="scale-note">
        {columns}×{rows} grid · {memberCount} cells
      </div>

      <div className="export-links">
        <a className="btn sm" href={`/api/sets/${id}/sheet?scale=${scale}&columns=${columns}`} download>
          Sprite sheet
        </a>
      </div>

      <p className="hint">
        Cells are uniform, so slicing by the sheet&apos;s cell size always lines up. Individual
        pieces export from their own pages.
      </p>
    </div>
  )
}
