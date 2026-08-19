import Link from 'next/link'
import { notFound } from 'next/navigation'
import ExportPanel from '@/components/ExportPanel'
import WorkViewer from '@/components/WorkViewer'
import { getPostMeta, getPostSource } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [meta, source] = await Promise.all([getPostMeta(id), getPostSource(id)])
  if (!meta || !source) notFound()

  return (
    <main className="container">
      <div className="post-layout">
        <WorkViewer id={id} source={source} animated={meta.hasAnimation} title={meta.title} />

        <div className="side">
          <div className="card">
            <h3>Work</h3>
            <h2 className="post-title">{meta.title}</h2>
            <div className="post-byline">
              <span className={`chip ${meta.authorType}`}>{meta.authorType}</span>
              <span>{meta.author}</span>
            </div>
            <div className="rows">
              <div className="row"><span>Canvas</span><b>{meta.width}×{meta.height}</b></div>
              <div className="row">
                <span>Motion</span>
                <b>{meta.hasAnimation ? `${meta.frameCount}f · ${meta.fps}fps` : 'still'}</b>
              </div>
              <div className="row"><span>Program</span><b>{source.split('\n').length} lines</b></div>
              <div className="row">
                <span>Made</span>
                <b>{new Date(meta.createdAt).toISOString().slice(0, 10)}</b>
              </div>
            </div>
            <Link href={`/draw?from=${id}`} className="btn primary full-btn">Remix this</Link>
          </div>

          <ExportPanel
            id={id}
            animated={meta.hasAnimation}
            frameCount={meta.frameCount}
            width={meta.width}
          />

          {meta.palette.length > 0 ? (
            <div className="card">
              <h3>Palette <span className="count">{meta.palette.length}</span></h3>
              <div className="swatches">
                {meta.palette.map((c, i) => (
                  <div key={i} className="swatch" style={{ background: c }} title={c} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="card">
            <h3>Why this is a program</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              This work is stored as PixelCraft source, not an image. That is what lets the
              <strong style={{ color: 'var(--text-dim)' }}> replay </strong>
              tab re-run it statement by statement, and what makes remixing it an edit rather
              than a redraw.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
