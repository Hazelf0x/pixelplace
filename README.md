# PixelPlace

Pixel art that is **source code**. Every piece is a PixelCraft program — written by hand or by Claude — compiled to exact pixels on an exact grid.

Because a work is a program and not a bitmap, it can be **replayed statement by statement**, animated, remixed as an edit rather than a redraw, and verified as AI- or human-authored.

## Monorepo layout

```
packages/
  pixelcraft/   # The PixelCraft DSL engine (lexer/parser/compiler/runtime + headless PNG/GIF renderer).
                # Native document format for every work. A human's editor and the AI emit the SAME source.
  mcp-server/   # MCP server exposing the engine, so any Claude session can draw by writing a program.
apps/
  web/          # Next.js 15 app: gallery, studio, sets, render/export APIs.
```

## Status

- `@pixelplace/pixelcraft` extracted, type-checked, deterministic headless render verified.
- `/draw` — studio: PixelCraft source → live server-rendered preview, palette swatches,
  diagnostics, publish. Describing a piece from the gallery hero drops you here mid-draw.
- **Posts move.** `renderAnimation()` encodes every frame of a `frame`/`frames`/`timeline`
  program into a looping GIF headlessly. The feed plays them; the editor has a
  play/pause toggle and a frame scrubber; the AI is told animation is welcome.
- **Replay.** `renderReplay()` re-runs a program and captures the canvas after every
  statement that changes it, pairing each step with the source line that caused it.
  A step is defined by the render actually differing — declarations are skipped
  automatically, so it stays correct as the DSL grows.
- `/p/<id>` — a work: art / replay / source tabs, palette, and a remix button.
- Gallery lists works; stills serve PNG, animations serve GIF.
- **Export.** `renderSpriteSheet()` tiles every frame onto an exact grid, so slicing by
  `frameWidth`/`frameHeight` always lines up. Downloads carry `X-Sprite-*` slicing headers.
- **Asset sets.** `/sets/new` plans one shared palette, then draws every member against it
  in parallel. Consistency is *enforced*, not hoped for: each member is checked against the
  pixels it actually painted (`extractUsedColors`), and against how much canvas it covered
  (`measureCoverage`) — a stray hex or a solid-block "drawing" is sent back with the exact
  complaint. `renderSetSheet()` exports the whole family as one uniform grid.
- **Purity:** only valid PixelCraft can be stored (invalid art is rejected).
- Storage is disk-based for now (`apps/web/.data/`); Postgres lands in Milestone 3.

## Using PixelCraft from a Claude session

`.mcp.json` registers a local MCP server exposing the engine. Build it once, then any Claude
session in this repo can draw:

```bash
npm run build
```

The server makes no model calls and needs no API key — **the calling model is the artist**. It
gets the compiler, the renderer, and the language's own docs, and it gets the rendered image
back, so it can judge whether the drawing is right rather than merely whether it compiled.

| Tool | Does |
|---|---|
| `pixelcraft_guide` | The authoring guide, generated from the language's own docs |
| `pixelcraft_check` | Compile and report diagnostics, palette, colors *painted*, coverage — no image |
| `pixelcraft_render` | Render to PNG and hand the image back; optionally write it to disk |
| `pixelcraft_animate` | Render every frame to a looping GIF |
| `pixelcraft_sheet` | Tile programs (or one program's frames) onto a uniform sprite-sheet grid |

## Develop

```bash
npm install                          # install workspace deps
npm run build                        # build the engine + the MCP server
npm test                             # engine smoke test + MCP protocol smoke test
npm run dev -w @pixelplace/web       # run the app (http://localhost:3000)
```

## Roadmap

PixelCraft's real value is as the **correctness layer for AI-generated pixel art** — a model
can't hold a mouse, but it can emit a program, and a program compiles to an exact grid with a
locked palette and frames that actually line up. No image model can promise that. The highest-
value application is **game assets**, where those are hard requirements rather than nice-to-haves.

Ordered by decision, not by size:

1. ~~**Export**~~ — done. PNG at a chosen scale, GIF, tiled sprite sheets, and the `.pc`
   source itself. Art can leave the building.
2. ~~**Asset sets**~~ — done. One prompt to a family sharing an *enforced* palette.
3. ~~**MCP server**~~ — done. `packages/mcp-server` makes PixelCraft a capability, not a
   destination.
4. **Eval harness** — the stable diagnostic codes make "which models write correct PixelCraft,
   and which features do they under-use?" an objectively measurable question.

Deprioritized: auth, Postgres, and social/feed mechanics. An imageboard needs volume and social
velocity, and requiring code to post kills both — the format's strengths lie elsewhere.

## Origins

PixelCraft began as a standalone pixel-art DSL (`CodingArt/`). PixelPlace adopts it as the platform's native format — continuing that project by giving it a product.
