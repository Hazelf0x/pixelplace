import Link from 'next/link'
import Code from '@/components/Code'
import {
  DOCS_ADDITIONAL_NOTES,
  DOCS_REFERENCE_ROWS,
  type DocsReferenceRow
} from '@pixelplace/pixelcraft/docs'

export const metadata = {
  title: 'PixelCraft Guide — PixelPlace',
  description: 'Learn the small PixelCraft language well enough to read, tweak, and direct your pixel art.'
}

const STARTER = `canvas 16x16
pal bg=#1a1c2c ink=#f4f4f4 heart=#ef7d57

rect 0,0 16x16 bg
rect 4,4 8x8 ink
px 6,6 9,6 bg
rect 6,9 4x2 heart`

const RECIPES = [
  {
    title: 'Change a colour',
    text: 'Palette names make global art direction legible. Change one hex value; every use updates.',
    code: `pal sky=#1a1c2c glow=#ffcd75
rect 0,0 16x16 sky
circ 8,8 3 glow`
  },
  {
    title: 'Move a whole form',
    text: 'Wrap related marks in offset. One pair of numbers moves the complete cluster.',
    code: `offset 2,-1 {
  rect 4,5 8x6 body
  px 6,7 9,7 eye
}`
  },
  {
    title: 'Make a clean loop',
    text: 'A timeline declares its frames. Expressions keep motion consistent and easy to revise.',
    code: `timeline 0..3 {
  each {
    circ 8,(8 - sin01($t) * 2) 3 glow
  }
}`
  }
] as const

function ReferenceGroup({ title, rows }: { title: string; rows: readonly DocsReferenceRow[] }) {
  return (
    <section className="reference-section">
      <h2>{title}</h2>
      <div className="reference-grid">
        {rows.map((row, index) => (
          <article className="reference-row" key={`${row.commandCode}-${index}`}>
            <code className="reference-command">{row.commandCode}</code>
            <p dangerouslySetInnerHTML={{ __html: row.descriptionHtml }} />
            <code className="reference-example">{row.exampleCode}</code>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function GuidePage() {
  return (
    <main className="container guide-page">
      <section className="guide-hero">
        <div className="eyebrow">PixelCraft for humans</div>
        <h1>Read it. Tweak it. Hand it back.</h1>
        <p>
          You never have to write PixelCraft to create with PixelPlace—your agent can do that.
          Learning a few lines simply gives you another way to steer: change a colour, nudge a
          shape, or understand exactly what your collaborator made.
        </p>
        <div className="hero-actions">
          <Link href="/studio" className="btn primary">Open Studio</Link>
          <a href="#reference" className="btn ghost">Browse the reference</a>
        </div>
      </section>

      <section className="guide-callout">
        <div>
          <div className="eyebrow">The whole idea</div>
          <p>
            A program starts with an exact canvas and named colours, then draws from back to
            front. The source stays readable, diffable, and reversible.
          </p>
        </div>
        <Code source={STARTER} />
      </section>

      <section className="guide-section">
        <div className="eyebrow">Three useful moves</div>
        <h2>Enough language to join the edit</h2>
        <div className="recipe-grid">
          {RECIPES.map((recipe) => (
            <article className="recipe-card" key={recipe.title}>
              <h3>{recipe.title}</h3>
              <p>{recipe.text}</p>
              <Code source={recipe.code} />
            </article>
          ))}
        </div>
      </section>

      <div className="guide-truth">
        This reference comes from the same compiler documentation as the agent&apos;s{' '}
        <code>get_pixelcraft_guide</code> tool, so the human and agent learn from one source of truth.
      </div>

      <div id="reference">
        <ReferenceGroup title="Set up and draw" rows={DOCS_REFERENCE_ROWS.setupDrawing} />
        <ReferenceGroup title="Position, compose, and animate" rows={DOCS_REFERENCE_ROWS.positioningComposition} />
      </div>

      <section className="reference-section">
        <h2>Semantics worth knowing</h2>
        <ul className="semantics-list">
          {DOCS_ADDITIONAL_NOTES.coreSemanticsHtml.map((note) => (
            <li key={note} dangerouslySetInnerHTML={{ __html: note }} />
          ))}
        </ul>
      </section>

      <section className="guide-finish">
        <p>You know enough. Make one change, look at the canvas, and let the conversation continue.</p>
        <Link href="/studio" className="btn primary">Create with an agent</Link>
      </section>
    </main>
  )
}
