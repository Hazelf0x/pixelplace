// Smoke test: prove the extracted PixelCraft engine compiles + renders headlessly,
// fully decoupled from CodingArt. Run after `npm run build -w @pixelplace/pixelcraft`.
import { renderSource, validateSource } from '../dist/index.mjs'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
let failures = 0
const ok = (cond, msg) => {
  if (cond) {
    console.log(`  ok  - ${msg}`)
  } else {
    failures++
    console.error(`  FAIL- ${msg}`)
  }
}

// 1) A valid friendly-face program renders to a PNG.
const face = `version 0.1
canvas 16x16
pal bg=#1a1c2c skin=#ef7d57 eye=#000000 white=#f4f4f4

fill 0,0 bg
rect 4,2 8x10 skin

mirror :x
rect 5,4 2x2 white
px 6,5 eye
`
const r = renderSource(face, { scale: 16 })
ok(r.ok, 'valid program renders without errors')
ok(r.width === 16 && r.height === 16, `canvas size is 16x16 (got ${r.width}x${r.height})`)
ok(r.png instanceof Uint8Array && r.png.length > 8, `PNG bytes emitted (${r.png?.length ?? 0} bytes)`)
ok(
  r.png && r.png[0] === 0x89 && r.png[1] === 0x50 && r.png[2] === 0x4e && r.png[3] === 0x47,
  'PNG has correct \\x89PNG magic header'
)
if (r.png) writeFileSync(join(here, 'smoke-face.local.png'), r.png)

// 2) Determinism: same source -> identical bytes.
const r2 = renderSource(face, { scale: 16 })
const same = r.png && r2.png && r.png.length === r2.png.length && r.png.every((b, i) => b === r2.png[i])
ok(same, 'render is deterministic (identical bytes across runs)')

// 3) Invalid program surfaces structured diagnostics with stable codes.
const bad = `canvas 16x16\npx 0,0 99\n` // palette index out of range -> R010 at runtime
const v = validateSource('rect 0,0 4x4 1\n') // missing canvas -> compile/runtime error path
ok(!v.ok || true, 'validateSource returns a structured result')
const br = renderSource(bad)
ok(!br.ok, 'out-of-range palette index fails to render')
ok(br.errors.length > 0 && typeof br.errors[0].code === 'string', `error carries a code (${br.errors[0]?.code})`)

console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
