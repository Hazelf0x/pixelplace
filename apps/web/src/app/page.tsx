import Link from 'next/link'
import { GALLERY, allTags, previewGif, previewPng } from '@/lib/gallery'

export default function GalleryPage() {
  const animated = GALLERY.filter((entry) => entry.frameCount > 0).length
  const tags = allTags().slice(0, 9)

  return (
    <main className="container">
      <section className="hero">
        <div className="eyebrow">Pixel art that is source code</div>
        <h1>
          Your agent can&apos;t hold a mouse.
          <br />
          <em>It can write a program.</em>
        </h1>
        <p>
          An image model cannot hold a grid — wrong pixel sizes, anti-aliased edges, colors that
          drift off palette. A program can. Every piece here is PixelCraft source that compiles to
          an exact canvas with a locked palette and frames that line up.
        </p>
        <p>
          This page hands your agent real tools through <strong>WebMCP</strong>. It writes the
          program; you watch the canvas and say what to change.
        </p>
        <p>
          Built for indie game makers, pixel artists, and small teams who want AI speed without
          surrendering exact pixels—or authorship.
        </p>
        <div className="hero-actions">
          <Link href="/studio" className="btn primary">
            Open the Studio
          </Link>
          <Link href="/guide" className="btn ghost">
            Learn PixelCraft
          </Link>
          <Link href="/about" className="btn ghost">
            How it works
          </Link>
        </div>
      </section>

      <section className="impact-grid" aria-label="Why PixelPlace works">
        <article>
          <span>01</span>
          <h2>Exact by construction</h2>
          <p>Canvas size, palette, geometry, and frame count are enforced by a real compiler.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Human-directed</h2>
          <p>Ask in natural language, judge with your eyes, undo freely, or edit the source yourself.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Local and portable</h2>
          <p>No account or API key. Your editable program and exports stay in the browser.</p>
        </article>
      </section>

      <section className="gallery-head">
        <h2>
          {GALLERY.length} programs <span className="pane-note">· {animated} of them animate</span>
        </h2>
        <div className="tagrow">
          {tags.map(({ tag, count }) => (
            <span key={tag} className="tag">
              {tag} <em>{count}</em>
            </span>
          ))}
        </div>
      </section>

      <section className="grid">
        {GALLERY.map((entry) => {
          const gif = previewGif(entry)
          return (
            <Link key={entry.slug} href={`/studio?example=${entry.slug}`} className="card">
              <div className="card-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={gif ?? previewPng(entry)}
                  alt={entry.title}
                  loading="lazy"
                  width={entry.width * entry.scale}
                  height={entry.height * entry.scale}
                />
                {entry.frameCount > 0 && <span className="badge">{entry.frameCount}f</span>}
              </div>
              <div className="card-meta">
                <strong>{entry.title}</strong>
                <span className="pane-note">
                  {entry.width}×{entry.height} · {entry.lines} lines
                </span>
              </div>
            </Link>
          )
        })}
      </section>
    </main>
  )
}
