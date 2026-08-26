# PixelPlace

**Pixel art that is source code — built for people and their agents to make together.**

An image model cannot hold a grid. Ask one for a 32×32 sprite and you get something 31 pixels
wide with anti-aliased edges and colors that drifted off palette; ask for four walk-cycle frames
and you get four different characters. That is not a prompting problem — a diffusion model has
no representation of a grid.

A program does. Every piece here is a [PixelCraft](#the-language) program, so `canvas 32x32`
means exactly 32×32, colors come only from the declared palette, and an eight-frame loop has
exactly eight frames that line up. Correctness by compilation, not by luck.

PixelPlace exposes that compiler to your agent over **[WebMCP](https://webmachinelearning.github.io/webmcp/)**.

## The division of labour

WebMCP tool results must be JSON, so a tool **cannot return an image**. That constraint
describes the right design rather than blocking it:

| | owns | because |
|---|---|---|
| **The agent** | structure — grammar, palette compliance, frame counts, coverage, silhouette | all of it is checkable in text |
| **The person** | taste — whether it looks good, and whether it is a drawing of *the thing* | that needs eyes |

We learned the second row the hard way: an earlier version of this project produced a sprite
that compiled cleanly, matched its palette perfectly, and was a solid blue rectangle. Structural
correctness does not imply "is a slime".

So the agent never pretends to see. `describe_canvas` hands it a coarse **text map** — one
character per region, dominant color, `.` for transparent — enough to check that a shape landed
where it meant, and honest about being nothing more:

```
....444.......      4 #2a2a3a   hair
....2222......      2 #e8b087   skin
....2220......      0 #3a6ea5   tunic
...00330......      3 #b8c4d0   armour
...00330......      1 #26496e   legs
...11..11.....
```

## The tools

Registered with `document.modelContext.registerTool` in
[`src/lib/studio-tools.ts`](apps/web/src/lib/studio-tools.ts).

| Tool | Does |
|---|---|
| `get_pixelcraft_guide` | The language, generated from the compiler's own docs so it cannot drift |
| `check_program` | Compile a draft *without* touching the canvas — diagnostics with line numbers, declared palette vs colors actually **painted**, coverage. The cheap refine loop |
| `set_program` | Put it on the canvas. Rejected unless it compiles, so the canvas never holds a broken program |
| `get_program` | Read what is there now — including edits the person made by hand |
| `describe_canvas` | The text map above, plus bounds, legend and coverage |
| `set_frame` | Pause an animation on one moment |
| `list_examples` / `load_example` | 58 finished programs to study or remix |
| `export_artwork` | Save a PNG, a GIF, or the `.pc` source |

Every tool call appears in an activity feed on the page, so the person can watch the agent work.

## Everything runs in your browser

The lexer, parser, compiler, interpreter and renderer are all client-side
([`@pixelplace/pixelcraft/browser`](packages/pixelcraft/src/browser.ts)). No API key, no
account, no quota, no database, and no server ever sees what you draw. Exports are local too:
PNG via the browser's own encoder, GIF via a pure-JS one, and `.pc` source — the only format
that round-trips back into the editor.

Because the program *is* the document, a drawing is a string: small enough to paste into a
chat, diff in git, or hand back to an agent to edit.

## Monorepo layout

```
packages/
  pixelcraft/   # The DSL engine. Two entries: Node (adds PNG/GIF encoding) and browser.
  mcp-server/   # A stdio MCP server, so a coding agent can draw outside the browser too.
apps/
  web/          # Next.js 15 app: gallery, studio, WebMCP tool surface.
```

## The language

PixelCraft declares a canvas and a palette, then draws:

```
canvas 32x32
pal sky=#1b2b3a ball=#f0c060

timeline 0..7 {
  each {
    rect 0,0 32x32 sky
    circ (2 + $frame * 4), 16 3 ball
  }
}
```

Primitives (`px/rect/line/circ/arc/poly/ellipse/glow/dither/fill` plus outline variants), reuse
(`group/bitmap/stamp/tile/tileset/tilemap/scatter/emit`), layers, fonts, expressions with
intrinsics, and animation via `frame`/`frames`/`timeline`. Diagnostics have stable codes
(P/I/S/R/W series) — which is what makes an agent's refine loop work.

## Develop

```bash
npm install
npm run build                        # engine (both entries) + MCP server
npm test                             # smoke + conformance + MCP protocol tests
npm run gallery -w @pixelplace/web   # regenerate bundled examples
npm run dev -w @pixelplace/web       # http://localhost:3000
```

To connect an agent: open the Studio in ChatGPT's in-app browser, or in Chrome with
`chrome://flags/#enable-webmcp-testing` enabled.

### Staying in step with CodingArt

`packages/pixelcraft` is a *copy* of `CodingArt/src/{lang,runtime}`, taken on the assumption
that the semantics were frozen. They were not: upstream later grew `pow`, `offset` and `fade`,
and two showcase programs silently stopped compiling here. Nothing noticed, because nothing was
checking.

`npm run test:conformance` now checks. It renders all 58 upstream examples, reproduces two of
their reference PNGs **byte for byte**, and reports any upstream line with no counterpart here.
Point it elsewhere with `PIXELCRAFT_UPSTREAM`; it skips cleanly when upstream is absent.

One divergence is deliberate and declared in the test: both codebases independently found that
`W014` fired on expression-driven animation and fixed it differently. Upstream falls silent
whenever geometry is dynamic; this engine binds the frame built-ins and *evaluates* the
expressions, so the warning still fires on frames that genuinely do not move.

## Origins

PixelCraft began as a standalone pixel-art DSL (`CodingArt/`). PixelPlace adopts it as a native
format and gives it an audience it is actually suited to: agents, which cannot hold a mouse but
can write a program.

## License

MIT — see [LICENSE](LICENSE).
