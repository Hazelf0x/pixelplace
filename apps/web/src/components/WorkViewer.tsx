'use client'

import { useState } from 'react'
import ReplayView from './ReplayView'

type Tab = 'art' | 'replay' | 'source'

/**
 * The three ways to look at a work: as a picture, as a construction, and as the
 * program it actually is. Replay mounts lazily — its payload is one PNG per step.
 */
export default function WorkViewer({
  id,
  source,
  animated,
  title
}: {
  id: string
  source: string
  animated: boolean
  title: string
}) {
  const [tab, setTab] = useState<Tab>('art')
  const sourceLines = source.split(/\r?\n/)

  return (
    <div>
      <div className="tabs" role="tablist">
        {(['art', 'replay', 'source'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'art' ? (
        <div className="stage post-stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={animated ? `/api/posts/${id}/anim` : `/api/posts/${id}/thumb`} alt={title} />
        </div>
      ) : null}

      {tab === 'replay' ? <ReplayView source={source} id={id} /> : null}

      {tab === 'source' ? (
        <div className="card" style={{ padding: '14px 0' }}>
          <div className="source">
            {sourceLines.map((text, i) => (
              <div key={i} className="ln">
                <span className="num">{i + 1}</span>
                <span>{text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
