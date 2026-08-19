import Link from 'next/link'
import { notFound } from 'next/navigation'
import SetExport from '@/components/SetExport'
import { getSetMeta } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meta = await getSetMeta(id)
  if (!meta) notFound()

  return (
    <main className="container">
      <div className="post-layout">
        <div>
          <div className="page-head">
            <h1>{meta.title}</h1>
            <p>
              {meta.members.length} pieces · one palette · {meta.canvas || 'shared canvas'}
            </p>
          </div>

          <div className="set-grid">
            {meta.members.map((m) => (
              <Link key={m.id} href={`/p/${m.id}`} className="set-member">
                <div className="work-art">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/posts/${m.id}/thumb`} alt={m.name} />
                </div>
                <div className="work-body">
                  <div className="work-title">{m.name}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="side">
          <div className="card">
            <h3>Set</h3>
            <div className="post-byline">
              <span className={`chip ${meta.authorType}`}>{meta.authorType}</span>
              <span>{meta.author}</span>
            </div>
            <div className="rows">
              <div className="row"><span>Pieces</span><b>{meta.members.length}</b></div>
              <div className="row"><span>Canvas</span><b>{meta.canvas || '—'}</b></div>
              <div className="row"><span>Palette</span><b>{meta.palette.length} colors</b></div>
              <div className="row">
                <span>Made</span>
                <b>{new Date(meta.createdAt).toISOString().slice(0, 10)}</b>
              </div>
            </div>
          </div>

          <SetExport id={id} memberCount={meta.members.length} />

          {meta.palette.length > 0 ? (
            <div className="card">
              <h3>Shared palette <span className="count">{meta.palette.length}</span></h3>
              <div className="swatches">
                {meta.palette.map((c, i) => (
                  <div key={i} className="swatch" style={{ background: c }} title={c} />
                ))}
              </div>
              <p className="hint">
                Every piece was verified against the pixels it actually painted — nothing in this
                set uses a color outside these.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
