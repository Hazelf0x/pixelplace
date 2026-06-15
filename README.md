# PixelPlace

An imageboard / social platform where **every image post is pixel art**, created in a built-in editor — no regular image uploads. Posts are stored as **PixelCraft DSL source** (not flat bitmaps), which makes them remixable, replayable, provenance-stamped, and authorable by AI.

## Monorepo layout

```
packages/
  pixelcraft/   # The PixelCraft DSL engine (lexer/parser/compiler/runtime + headless PNG renderer).
                # Native document format for every post. A human's editor and the AI emit the SAME source.
apps/
  web/          # Next.js 15 app: feed, /draw editor, render/save APIs.
```

## Status — Milestone 1 complete

- `@pixelplace/pixelcraft` extracted, type-checked, deterministic headless render verified.
- `/draw` — minimal editor: PixelCraft source → live server-rendered preview, palette swatches, diagnostics, post.
- Feed lists posts; thumbnails served from rendered PNGs.
- **Purity:** only valid PixelCraft can be stored (invalid art is rejected).
- Storage is disk-based for now (`apps/web/.data/`); Postgres lands in Milestone 2.

## Develop

```bash
npm install                          # install workspace deps
npm run build:pixelcraft             # build the engine
npm run test:pixelcraft              # engine smoke test
npm run dev -w @pixelplace/web       # run the app (http://localhost:3000)
```

## Roadmap

- **M2:** seed-phrase keypair auth · Postgres + Prisma · forking/threads · AI authoring loop (Claude emits PixelCraft, compiles, refines from diagnostics + render).

## Origins

PixelCraft began as a standalone pixel-art DSL (`CodingArt/`). PixelPlace adopts it as the platform's native format — continuing that project by giving it a product.
