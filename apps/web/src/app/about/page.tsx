import Link from 'next/link'

export const metadata = {
  title: 'How it works — PixelPlace',
  description: 'Why pixel art is the right thing to hand an agent, and how the WebMCP tools work.'
}

export default function AboutPage() {
  return (
    <main className="container prose">
      <div className="eyebrow">How it works</div>
      <h1 style={{ fontSize: 34, letterSpacing: '-0.8px', margin: '0 0 18px' }}>
        Agents can&apos;t draw. They can write programs.
      </h1>

      <p>
        Ask an image model for a 32×32 sprite and you get something 31 pixels wide with
        anti-aliased edges and colors that drifted off your palette. Ask for four walk-cycle
        frames of the same character and you get four different characters. This is not a
        prompting problem — a diffusion model has no representation of a grid.
      </p>
      <p>
        A program does. PixelCraft is a small language where{' '}
        <code>canvas 32x32</code> means exactly 32×32, colors come only from the declared
        palette, and an eight-frame loop has exactly eight frames that line up. Correctness
        comes from compilation, not from luck.
      </p>
      <p>
        So the interesting question is not &ldquo;can an agent make pixel art&rdquo; but{' '}
        <strong>what should each side of the collaboration do</strong>.
      </p>

      <h2>Who it is for</h2>
      <p>
        PixelPlace is for indie game makers, pixel artists, and small creative teams who want an
        agent to accelerate exploration without giving up a precise grid or an editable source.
        Natural-language direction is the default. Hand-editing is an optional second instrument,
        not homework you must finish before you can create.
      </p>

      <h2>The division of labour</h2>
      <p>
        WebMCP tool results have to be JSON — a tool cannot return an image. That constraint
        turns out to describe the right design rather than block it.
      </p>
      <h3>The agent owns structure</h3>
      <p>
        Grammar, palette compliance, frame counts, coverage, silhouette. All of it is checkable
        in text, and all of it is what the agent is good at. <code>check_program</code> compiles
        a draft and hands back error codes with line numbers, the palette the program{' '}
        <em>declares</em>, the colors it actually <em>paints</em> — those differ the moment
        someone slips in a raw hex literal — and how much of the canvas it filled.
      </p>
      <h3>The person owns taste</h3>
      <p>
        Whether it looks good, and whether it is a drawing of the thing that was asked for. We
        learned this one the hard way: an earlier version of this project generated a sprite
        that compiled cleanly, matched its palette perfectly, and was a solid blue rectangle.
        Structural correctness does not imply &ldquo;is a slime&rdquo;.
      </p>
      <p>
        So the agent never pretends to see. <code>describe_canvas</code> gives it a coarse text
        map — one character per region, dominant color, <code>.</code> for transparent — which
        is enough to tell whether a shape landed where it meant or whether the subject is
        off-centre, and honest about being nothing more than that:
      </p>
      <pre>
        <code>{`....444.......
....2222......
....2220......
...00330......
...00330......
...11..11.....`}</code>
      </pre>
      <p>
        That is a character with hair, a face, a torso with an armour stripe, and two legs. An
        agent can reason about it. It still cannot tell you if the art is any good — which is
        exactly what the person watching the canvas is for.
      </p>

      <h2>A normal session</h2>
      <ol>
        <li>Tell the agent what to make, or ask it to remix a finished example.</li>
        <li>It compile-checks the PixelCraft program before applying it to the canvas.</li>
        <li>You judge the visible result and describe a revision in ordinary language.</li>
        <li>Undo a revision at any time—or change one line yourself and ask the agent to continue.</li>
      </ol>
      <p>
        That last step is genuine co-editing: <code>get_program</code> reads the current Studio
        source, including your hand edits, so neither collaborator owns a separate stale copy.
        The visible history makes both human and agent changes reversible.
      </p>

      <h2>What runs where</h2>
      <p>
        Everything runs in your browser. The lexer, parser, compiler, interpreter and renderer
        are all client-side; the tools call straight into them. No API key, no account, no
        quota, and no server ever sees what you draw. The page works as an ordinary pixel
        editor with no agent attached.
      </p>
      <p>
        Exports are local too — PNG through the browser&apos;s own encoder, GIF through a
        pure-JS encoder, and <code>.pc</code> source, which is the only format that
        round-trips back into the editor. Because the program <em>is</em> the document, a
        drawing is a string: small enough to paste in chat, diff in git, or hand back to an
        agent to edit.
      </p>

      <h2>The tools</h2>
      <ul>
        <li>
          <code>get_pixelcraft_guide</code> — the language, generated from the compiler&apos;s
          own docs so it cannot drift
        </li>
        <li>
          <code>check_program</code> — compile a draft without touching the canvas; the cheap
          refine loop
        </li>
        <li>
          <code>set_program</code> — put it on the canvas, rejected unless it compiles
        </li>
        <li>
          <code>get_program</code> — read what is there now, including hand edits
        </li>
        <li>
          <code>describe_canvas</code> — the text map above
        </li>
        <li>
          <code>set_frame</code> — pause an animation on one moment
        </li>
        <li>
          <code>list_examples</code> / <code>load_example</code> — 58 finished programs to
          study or remix
        </li>
        <li>
          <code>export_artwork</code> — save a PNG, GIF, or the source
        </li>
      </ul>

      <h2>Try it</h2>
      <p>
        Open the Studio in ChatGPT&apos;s in-app browser, or in Chrome with{' '}
        <code>chrome://flags/#enable-webmcp-testing</code> enabled, and ask your agent for a
        walk cycle. Then change a colour by hand and ask it to keep going — it reads the
        change through <code>get_program</code> and works from where you left it.
      </p>
      <p style={{ marginTop: 26 }}>
        <Link href="/studio" className="btn primary">
          Open the Studio
        </Link>
        {' '}
        <Link href="/guide" className="btn ghost">
          Read the human guide
        </Link>
      </p>
    </main>
  )
}
