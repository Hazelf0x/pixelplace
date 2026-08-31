import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Link from 'next/link'
import { GALLERY, allTags, previewGif, previewPng } from '@/lib/gallery'
import LivingHero from '@/components/LivingHero'
import LandingWebMcp from '@/components/LandingWebMcp'

/** The piece the front page replays. Chosen for having a lot of visible construction. */
const HERO_SLUG = 'fable_ink_sea_v2'

export default async function GalleryPage() {
  // Read at BUILD time. This route is statically prerendered, so the program is
  // inlined into the HTML and no server ever runs to serve it. (/studio had to stop
  // doing exactly this, but only because a query string made that route dynamic —
  // a traced-away file at request time. There is no request time here.)
  const heroSource = await readFile(
    join(process.cwd(), 'public', 'gallery', `${HERO_SLUG}.pc`),
    'utf8'
  )
  const heroEntry = GALLERY.find((entry) => entry.slug === HERO_SLUG)
  const animated = GALLERY.filter((entry) => entry.frameCount > 0).length
  const tags = allTags().slice(0, 9)

  return (
    <main className="container">
      <LandingWebMcp />
      <section className="hero">
        <div className="eyebrow">Pixel art that is source code</div>
        <h1>
          Your agent can&apos;t hold a mouse.
          <br />
          <em>It can write a program.</em>
        </h1>
      </section>

      {heroEntry && (
        <LivingHero source={heroSource} title={heroEntry.title} slug={HERO_SLUG} />
      )}

      <section className="hero hero-rest">
        <p>
          An image model cannot hold a grid — wrong pixel sizes, anti-aliased edges, colors that
          drift off palette. A program can. Every piece here is PixelCraft source that compiles to
          an exact canvas with a locked palette and frames that line up.
        </p>
        <p>
          This page hands your agent a <strong>WebMCP</strong> doorway into the Studio. There it
          writes the program; you watch the canvas and say what to change.
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
