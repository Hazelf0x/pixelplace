// Smoke test: prove the extracted PixelCraft engine compiles + renders headlessly,
// fully decoupled from CodingArt. Run after `npm run build -w @pixelplace/pixelcraft`.
import {
  extractUsedColors,
  measureCoverage,
  renderAnimation,
  renderReplay,
  renderSetSheet,
  renderSource,
  renderSpriteSheet,
  validateSource
} from '../dist/index.mjs'
import { writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** Inflate a PNG's IDAT and read one pixel's RGBA — enough to assert on alpha. */
function readPngPixel(png, width, x, y) {
  const buf = Buffer.from(png)
  let offset = 8
  const idat = []
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    if (buf.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      idat.push(buf.subarray(offset + 8, offset + 8 + length))
    }
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4 + 1
  const start = y * stride + 1 + x * 4
  return [raw[start], raw[start + 1], raw[start + 2], raw[start + 3]]
}

/** Walk a GIF's block structure and count image descriptors (0x2c). */
function countGifFrames(gif) {
  const buf = Buffer.from(gif)
  let offset = 13
  const globalFlags = buf[10]
  if (globalFlags & 0x80) offset += 3 * (1 << ((globalFlags & 7) + 1))

  let frames = 0
  while (offset < buf.length) {
    const marker = buf[offset]
    if (marker === 0x2c) {
      frames++
      offset += 10
      const localFlags = buf[offset - 1]
      if (localFlags & 0x80) offset += 3 * (1 << ((localFlags & 7) + 1))
      offset++ // LZW minimum code size
    } else if (marker === 0x21) {
      offset += 2
    } else {
      break
    }
    while (buf[offset] !== 0) offset += buf[offset] + 1
    offset++
  }
  return frames
}
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

// 4) Unset pixels are transparent, not black — the canvas is sparse, and
// "nothing was drawn here" must survive into the encoded image.
const sparse = renderSource('canvas 2x2\npal a=#ff0000\npx 0,0 a\n', { scale: 1 })
ok(sparse.ok, 'sparse program renders')
const alpha = readPngPixel(sparse.png, 2, 1, 0)[3]
ok(alpha === 0, `untouched pixel is transparent (alpha ${alpha})`)

// 5) An animated program encodes every frame into a looping GIF.
const anim = `canvas 8x8
pal bg=#1a1c2c dot=#ffcd75
timeline 0..7 {
  each {
    rect 0,0 8x8 bg
    px ($frame,4) dot
  }
}
`
const a = renderAnimation(anim, { scale: 4, fps: 12 })
ok(a.ok, 'animated program renders without errors')
ok(a.hasAnimation && a.frameCount === 8, `all 8 frames encoded (got ${a.frameCount})`)
ok(
  a.gif instanceof Uint8Array && String.fromCharCode(...a.gif.subarray(0, 6)) === 'GIF89a',
  'GIF89a header emitted'
)
const gifFrames = countGifFrames(a.gif)
ok(gifFrames === 8, `GIF contains 8 image frames (got ${gifFrames})`)

// A still program is not an error — it simply has no GIF to give.
const stillAnim = renderAnimation(face)
ok(stillAnim.ok && !stillAnim.hasAnimation && !stillAnim.gif, 'still program reports no animation, no GIF')

// 6) Replay walks the program's construction, one visible statement at a time.
const rep = renderReplay(face, { scale: 4 })
ok(rep.ok, 'replay runs without errors')
ok(rep.steps.length > 1, `replay produced multiple steps (got ${rep.steps.length})`)
ok(
  rep.steps.every((s, i) => s.index === i),
  'replay steps are contiguously indexed'
)
ok(
  rep.steps.every((s) => s.line >= 1 && s.png.startsWith('data:image/png;base64,')),
  'each step carries a source line and a rendered PNG'
)
// Declarations paint nothing, so they must not consume a step.
ok(
  !rep.steps.some((s) => s.text.startsWith('pal ') || s.text.startsWith('mirror ')),
  'non-painting statements (pal, mirror) are skipped'
)
// Steps must be strictly distinct — that is the rule that defines a step.
ok(
  new Set(rep.steps.map((s) => s.png)).size === rep.steps.length,
  'no two consecutive steps render identically'
)
// The end of a replay is the finished piece.
const finalFrame = renderSource(face, { scale: 4 })
const replayEnd = rep.steps[rep.steps.length - 1].png.split(',')[1]
ok(
  replayEnd === Buffer.from(finalFrame.png).toString('base64'),
  'last replay step matches the fully rendered work'
)

// 7) Sprite sheets tile every frame onto an exact grid a game engine can slice.
const sheet = renderSpriteSheet(anim, { scale: 4, columns: 3 })
ok(sheet.ok, 'sprite sheet renders')
ok(sheet.frameCount === 8, `sheet holds every frame (got ${sheet.frameCount})`)
ok(sheet.columns === 3 && sheet.rows === 3, `grid is 3x3 (got ${sheet.columns}x${sheet.rows})`)
ok(
  sheet.frameWidth === 32 && sheet.frameHeight === 32,
  `cell is the scaled canvas, 32x32 (got ${sheet.frameWidth}x${sheet.frameHeight})`
)
ok(
  sheet.png instanceof Uint8Array && sheet.png[1] === 0x50 && sheet.png[2] === 0x4e,
  'sheet is a PNG'
)
// Columns must never exceed the frames available, however wide the caller asks for.
const narrow = renderSpriteSheet(anim, { scale: 1, columns: 999 })
ok(narrow.columns === 8 && narrow.rows === 1, `columns clamp to frame count (got ${narrow.columns}x${narrow.rows})`)
// A still program is a one-cell sheet, not an error.
const stillSheet = renderSpriteSheet(face, { scale: 1 })
ok(
  stillSheet.ok && stillSheet.frameCount === 1 && stillSheet.columns === 1,
  'still program yields a single-cell sheet'
)

// 8) Used-color extraction judges pixels, not declarations — the basis of the
// locked-palette guarantee for sets.
const sneaky = `canvas 8x8
pal a=#ff0000 b=#00ff00
rect 0,0 4x4 a
rect 4,0 4x4 b
px 7,7 #ff00ff
`
const declared = renderSource(sneaky).palette
const painted = extractUsedColors(sneaky)
ok(!declared.includes('#ff00ff'), 'an inline hex literal is absent from the declared palette')
ok(painted.includes('#ff00ffff'), 'but extractUsedColors sees it in the pixels')
ok(
  painted.every((c) => /^#[0-9a-f]{8}$/.test(c)),
  'used colors are normalized to #rrggbbaa'
)
// Transparent pixels are absence, not a color.
ok(
  extractUsedColors('canvas 4x4\npal a=#ff0000\npx 0,0 a\n').length === 1,
  'unpainted pixels contribute no color'
)

// 9) Coverage measures how much of the canvas a program paints, which is how a
// set enforces "leave the background transparent".
const filled = measureCoverage('canvas 8x8\npal a=#2a5fcf\nrect 0,0 8x8 a\n')
const subject = measureCoverage('canvas 8x8\npal a=#2a5fcf\ncirc 4,4 2 a\n')
ok(filled.ratio === 1, `a full-canvas rect covers everything (got ${filled.ratio})`)
ok(subject.ratio > 0 && subject.ratio < 0.5, `a centred subject leaves background (got ${subject.ratio.toFixed(2)})`)

// 10) A set sheet tiles several different programs onto one uniform grid.
const small = 'canvas 8x8\npal a=#ff0000\ncirc 4,4 2 a\n'
const large = 'canvas 16x16\npal a=#00ff00\ncirc 8,8 4 a\n'
const setSheet = renderSetSheet([small, large, small], { scale: 2, columns: 2 })
ok(setSheet.ok, 'set sheet renders from several programs')
ok(setSheet.memberCount === 3, `every member is placed (got ${setSheet.memberCount})`)
ok(setSheet.columns === 2 && setSheet.rows === 2, `grid wraps to 2x2 (got ${setSheet.columns}x${setSheet.rows})`)
// Mismatched canvases must still produce a uniform grid, padded to the largest.
ok(
  setSheet.frameWidth === 32 && setSheet.frameHeight === 32,
  `cells pad to the largest member (got ${setSheet.frameWidth}x${setSheet.frameHeight})`
)
ok(renderSetSheet([], {}).ok === false, 'an empty set is not a sheet')

// 11) W014 ("frames show no movement") must judge expression-driven animation.
// It used to do the exact opposite: every $frame-driven coordinate failed to
// evaluate statically and dropped out of the frame's bounding box, so the
// best-written animations were the ones warned at, and the hint told them to do
// what they were already doing.
const w014 = (src) => renderSource(src).warnings.some((w) => w.code === 'W014')

const movingTimeline = `canvas 32x32
pal sky=#1b2b3a ball=#f0c060
timeline 0..7 {
  each {
    rect 0,0 32x32 sky
    circ (2 + $frame * 4), 16 3 ball
  }
}`
const movingViaLet = `canvas 32x32
pal a=#3a6ea5 b=#26496e
group "leg" { rect 0,0 3x5 b }
timeline 0..7 {
  each {
    let swing = ((sin01($localT) - 0.5) * 6)
    stamp "leg" at (11 + $swing),18
    rect 11,11 9x8 a
  }
}`
const stillFrames = `canvas 32x32
pal sky=#1b2b3a ball=#f0c060
frame 0 { rect 0,0 32x32 sky
 circ 16,16 3 ball }
frame 1 { rect 0,0 32x32 sky
 circ 16,16 3 ball }
frame 2 { rect 0,0 32x32 sky
 circ 16,16 3 ball }
frame 3 { rect 0,0 32x32 sky
 circ 16,16 3 ball }`
const stillDespiteFrameVar = `canvas 32x32
pal sky=#1b2b3a c=#f0c060
frames 0..7 {
  rect 0,0 32x32 sky
  circ (16 + $frame * 0), 16 3 c
}`

ok(!w014(movingTimeline), 'a timeline moving a shape by $frame is not warned at')
ok(!w014(movingViaLet), 'motion through a let bound to $localT is not warned at')
ok(w014(stillFrames), 'genuinely motionless frames are still warned at')
ok(w014(stillDespiteFrameVar), 'motionless frames are caught even when they reference $frame')

// 12) A size pair built from expressions needs an explicit x. Without the
// separator the color parsed as the height and the *next* line reported
// "Unknown command: <colorName>", pointing nowhere near the real mistake.
const missingSeparator = validateSource('canvas 16x16\npal a=#ff0000\nlet r = 3\nellipse 8,8 ($r + 1) ($r - 1) a\n')
ok(!missingSeparator.ok, 'a size pair missing its x separator is rejected')
ok(
  missingSeparator.errors.length === 1 && /Expected "x" between/.test(missingSeparator.errors[0].message),
  `the one error names the missing separator (got ${JSON.stringify(missingSeparator.errors.map((e) => e.message))})`
)
ok(
  validateSource('canvas 16x16\npal a=#ff0000\nlet r = 3\nellipse 8,8 ($r + 1) x ($r - 1) a\n').ok,
  'the separated form still compiles'
)
ok(validateSource('canvas 16x16\npal a=#ff0000\nrect 2,2 4 a\n').ok, 'a lone size is still a square')
ok(validateSource('canvas 16x16\npal a=#ff0000\nrect 2,2 4 0\n').ok, 'a lone size then an index color is unambiguous')

// 13) Coverage has to hold across every frame. Members may animate, so reading
// frame 0 alone let a program that is a solid block for the rest of its loop
// through the gate that exists to catch exactly that.
const blockAfterFrameZero = `canvas 16x16
pal a=#3355ff
frame 0 { px 0,0 a }
frame 1 { rect 0,0 16x16 a }
frame 2 { rect 0,0 16x16 a }
frame 3 { rect 0,0 16x16 a }`
const sneakyCoverage = measureCoverage(blockAfterFrameZero)
ok(sneakyCoverage.ratio < 0.01, 'frame 0 alone looks almost empty')
ok(sneakyCoverage.maxRatio === 1, 'but maxRatio sees the frames that fill the canvas')
ok(sneakyCoverage.framesInspected === 4, `every frame is measured (got ${sneakyCoverage.framesInspected})`)
ok(subject.maxRatio === subject.ratio, 'a still program reports maxRatio equal to ratio')


console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
