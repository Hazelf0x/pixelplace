import Link from 'next/link'
import PromptLauncher from '@/components/PromptLauncher'
import { listPosts, listSets } from '@/lib/storage'

// Gallery is a server component: it reads works straight from disk, no client fetch.
export const dynamic = 'force-dynamic'

export default async function GalleryPage() {
  const [works, sets] = await Promise.all([listPosts(), listSets()])

  return (
    <main className="container">
      <section className="hero">
        <div className="eyebrow">Pixel art that is source code</div>
        <h1>
          Describe it. <em>Claude draws it.</em>
        </h1>
        <p>
          Every piece here is a PixelCraft program, not a bitmap — so it compiles to exact
          pixels on an exact grid, animates, and can be replayed one statement at a time.
        </p>
        <PromptLauncher />
      </section>

      {sets.length > 0 ? (
        <>
          <div className="page-head">
            <h1>Sets</h1>
            <p>Families of pieces built against one enforced palette.</p>
          </div>
          <div className="gallery" style={{ marginBottom: 34 }}>
            {sets.map((s) => (
              <Link key={s.id} href={`/s/${s.id}`} className="work set-card">
                <div className="work-art">
                  {/* A set previews as a stack of its first four pieces. */}
                  {s.members.slice(0, 4).map((m) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={m.id} src={`/api/posts/${m.id}/thumb`} alt={m.name} />
                  ))}
                </div>
                <div className="work-body">
                  <div className="work-title">{s.title}</div>
                  <div className="work-meta">
                    <span className={`chip ${s.authorType}`}>{s.authorType}</span>
                    <span>{s.members.length} pieces</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className="page-head">
        <h1>Gallery</h1>
        <p>
          {works.length === 0
            ? 'Nothing here yet.'
            : `${works.length} ${works.length === 1 ? 'piece' : 'pieces'} — every one of them remixable.`}
        </p>
      </div>

      {works.length === 0 ? (
        <div className="empty">
          <h3>An empty canvas</h3>
          <p>Describe something above, or write the PixelCraft yourself.</p>
          <Link href="/draw" className="btn primary">Open the studio</Link>
        </div>
      ) : (
        <div className="gallery">
          {works.map((w) => (
            <Link key={w.id} href={`/p/${w.id}`} className="work">
              <div className="work-art">
                {/* Animated works show the GIF of every frame; stills show the PNG. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={w.hasAnimation ? `/api/posts/${w.id}/anim` : `/api/posts/${w.id}/thumb`}
                  alt={w.title}
                />
                {w.hasAnimation ? (
                  <span className="badge-anim">
                    <span className="dot" />
                    {w.frameCount}f
                  </span>
                ) : null}
              </div>
              <div className="work-body">
                <div className="work-title">{w.title}</div>
                <div className="work-meta">
                  <span className={`chip ${w.authorType}`}>{w.authorType}</span>
                  <span>{w.width}×{w.height}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
