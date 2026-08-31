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

## What is new, and what came before

PixelPlace is a pre-existing project that was rebuilt as an agent-native app during
the WebMCP Challenge submission period. The boundary is exact and visible in the
commit history:

| | |
|---|---|
| **Prior work** | Everything up to `57f6f8b` (19 Aug 2026). The PixelCraft compiler, interpreter and renderer; the stdio MCP server; the 58-program gallery. |
| **Submission-period work** | Everything from `06124af` onward (26 Aug 2026, 13:54 UTC) — after the period opened on 25 Aug 2026, 18:00 UTC. |

Every line of WebMCP code in this repository was written inside the submission
period. `git log --date=iso-strict 06124af~1..HEAD` shows the timestamps.

What was added in that window:

- The entire WebMCP tool surface — nine Studio tools plus the landing-page doorway, in
  [`src/lib/studio-tools.ts`](apps/web/src/lib/studio-tools.ts),
  [`src/components/LandingWebMcp.tsx`](apps/web/src/components/LandingWebMcp.tsx), and
  [`src/lib/webmcp.ts`](apps/web/src/lib/webmcp.ts).
- A rebuild from a server-rendered app with an API key into a fully client-side,
  stateless one, so an agent-driven page needs no account, no key and no backend.
- `renderReplayToRgba` and a browser export of the compiler's lexer, which the front
  page uses to replay a real program and to highlight PixelCraft with the same code
  that parses it.
- The interface itself, redrawn to obey the constraints the format enforces.

The compiler being *older* than the challenge is the point rather than a caveat: the
interesting question was never whether a language could be written, but what an agent
could do if it were handed one.

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

Every tool is registered through the imperative WebMCP API:

```js
document.modelContext.registerTool({
  name: 'check_program',
  description: 'Compile a draft without touching the canvas.',
  inputSchema: { /* JSON Schema */ },
  execute: async (input) => { /* returns JSON */ }
})
```

The landing page registers one doorway tool, and the nine stateful Studio tools are defined in
[`apps/web/src/lib/studio-tools.ts`](apps/web/src/lib/studio-tools.ts). All are registered
by [`apps/web/src/lib/webmcp.ts`](apps/web/src/lib/webmcp.ts), which resolves the host
object at runtime: Chrome 151 exposes the very same object on `navigator.modelContext`
and `document.modelContext`, so both are feature-detected and either will do. With
neither present nothing registers and the page is an ordinary pixel editor.

| Tool | Does |
|---|---|
| `open_pixelplace_studio` | Give an agent arriving on the gallery an explicit path into the stateful workspace |
| `get_pixelcraft_guide` | The language, generated from the compiler's own docs so it cannot drift |
| `check_program` | Compile a draft *without* touching the canvas — diagnostics with line numbers, declared palette vs colors actually **painted**, coverage. The cheap refine loop |
| `set_program` | Put it on the canvas. Rejected unless it compiles, so the canvas never holds a broken program |
| `get_program` | Read what is there now — including edits the person made by hand |
| `describe_canvas` | The text map above, plus bounds, legend and coverage |
| `set_frame` | Pause an animation on one moment |
| `list_examples` / `load_example` | 58 finished programs to study or remix |
| `export_artwork` | Save a PNG, GIF, game-ready sprite-sheet PNG, or `.pc` source |

Every tool call appears in an activity feed on the page, so the person can watch the agent work.

## The collaboration loop

PixelPlace is built for indie game makers, pixel artists, and small creative teams who want AI
speed without surrendering exact pixels or authorship. A normal session is intentionally small:

1. The person describes a scene, sprite, icon set, or animation.
2. The agent writes PixelCraft and uses `check_program` before applying it.
3. The person judges the real canvas and directs the next revision in natural language.
4. Either collaborator can edit the same source. The person can undo any revision; the agent
   calls `get_program` to continue from hand edits rather than a stale private copy.
5. The finished work exports as a still, loop, exact frame grid, or editable document; saved
   `.pc` files open back into the Studio as one safe, undoable revision.

Nobody has to learn the language to create. The human-facing `/guide` is there for people who
*want* direct control: changing a palette value, nudging a shape, or understanding what the agent
made. Its full reference and the agent's `get_pixelcraft_guide` come from the compiler's same
documentation table.

## Everything runs in your browser

The lexer, parser, compiler, interpreter and renderer are all client-side
([`@pixelplace/pixelcraft/browser`](packages/pixelcraft/src/browser.ts)). No API key, no
account, no quota, no database, and no server ever sees what you draw. Exports are local too:
PNG and sprite-sheet PNG via the browser's own encoder, GIF via a pure-JS one, and `.pc`
source — the editable format the Studio can validate and reopen.

Because the program *is* the document, a drawing is a string: small enough to paste into a
chat, diff in git, or hand back to an agent to edit.

## One product, three modules

**PixelPlace is the public product and WebMCP Challenge entry.** PixelCraft is its embedded
language engine—not a separate hosted backend—and the stdio MCP server is an optional adapter
for coding agents outside the browser. Keeping these modules open-source and in one repository
makes the boundary explicit:

```
person <-> agent <-> PixelPlace WebMCP tools <-> PixelCraft compiler -> canvas
```

The repository layout follows that boundary:

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

Verified end to end in Chrome 151 **stable** — no Canary build needed. Chrome exposes the same
object on `navigator.modelContext` and `document.modelContext`, and an agent-side harness at
`navigator.modelContextTesting`, whose `executeTool(name, jsonArgsString)` takes its arguments
as a JSON **string**. Without the flag nothing is exposed and the Studio is an ordinary pixel
editor, which is the intended fallback.

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
