// Smoke test: drive the server over real stdio with a real MCP client, so this
// exercises the protocol rather than the functions behind it.
// Run after `npm run build:mcp`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const entry = join(here, '..', 'dist', 'index.mjs')

let failures = 0
const ok = (cond, msg) => {
  if (cond) {
    console.log(`  ok  - ${msg}`)
  } else {
    failures++
    console.error(`  FAIL- ${msg}`)
  }
}

const transport = new StdioClientTransport({ command: 'node', args: [entry] })
const client = new Client({ name: 'pixelcraft-smoke', version: '1.0.0' })
await client.connect(transport)

const call = (name, args = {}) => client.callTool({ name, arguments: args })
const textOf = (r) => r.content.find((c) => c.type === 'text')?.text ?? ''
const imageOf = (r) => r.content.find((c) => c.type === 'image')

// 1) The server advertises its tools over the protocol.
const { tools } = await client.listTools()
const names = tools.map((t) => t.name).sort()
ok(
  names.join(',') ===
    'pixelcraft_animate,pixelcraft_check,pixelcraft_guide,pixelcraft_render,pixelcraft_sheet',
  `all five tools listed (${names.length})`
)
ok(
  tools.every((t) => typeof t.description === 'string' && t.description.length > 40),
  'every tool carries a description a model can act on'
)

// 2) The guide comes from the language's own docs.
const guide = await call('pixelcraft_guide')
ok(textOf(guide).includes('PixelCraft'), 'guide returns the authoring text')

// 3) check separates what a program DECLARES from what it PAINTS.
const sneaky = `canvas 8x8
pal a=#ff0000 b=#00ff00
rect 0,0 4x4 a
rect 4,0 4x4 b
px 7,7 #ff00ff
`
const checked = textOf(await call('pixelcraft_check', { source: sneaky }))
ok(checked.startsWith('Valid.'), 'a valid program checks out')
ok(
  /Declared palette \(2\)/.test(checked) && /Colors painted \(3\)/.test(checked),
  'an inline hex literal shows up as painted but not declared'
)
ok(/Coverage: \d+%/.test(checked), 'coverage is reported')

// 4) A broken program is an error, with the compiler's stable code.
const broken = await call('pixelcraft_check', { source: 'canvas 8x8\npx 0,0 99\n' })
ok(broken.isError === true, 'a failing program sets isError')
ok(textOf(broken).includes('R010'), 'the diagnostic code reaches the caller')

// 5) render hands back a real image, which is what lets a caller SEE its work.
const art = 'canvas 16x16\npal body=#67d7ff eye=#0c0d14\ncirc 8,9 5 body\npx 6,8 eye\npx 10,8 eye\n'
const rendered = await call('pixelcraft_render', { source: art, scale: 4 })
const img = imageOf(rendered)
ok(img !== undefined, 'render returns an image block')
ok(img?.mimeType === 'image/png', 'image block is a PNG')
ok(Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG', 'image data decodes to PNG bytes')

// 6) Animating a still program fails helpfully rather than silently.
const stillAnim = await call('pixelcraft_animate', { source: art })
ok(stillAnim.isError === true, 'animating a still program is an error')
ok(textOf(stillAnim).includes('timeline'), 'the refusal says how to fix it')

// 7) A real animation reports its frames.
const moving = 'canvas 8x8\npal bg=#1a1c2c dot=#ffcd75\ntimeline 0..7 { each { rect 0,0 8x8 bg\npx ($frame,4) dot } }\n'
const gif = await call('pixelcraft_animate', { source: moving, scale: 2 })
ok(!gif.isError, 'an animated program animates')
ok(textOf(gif).includes('8 frames'), 'frame count is reported')

// 8) Sheets tile onto a uniform grid and say how to slice it.
const cell = (c) => `canvas 8x8\npal a=${c}\ncirc 4,4 3 a\n`
const sheet = await call('pixelcraft_sheet', {
  sources: [cell('#ef7d57'), cell('#67d7ff'), cell('#7ee787'), cell('#ffcd75')],
  columns: 2,
  scale: 2
})
ok(textOf(sheet).includes('2x2 grid'), 'sheet wraps to the requested columns')
ok(/Cell size: \d+x\d+/.test(textOf(sheet)), 'sheet reports its slicing boundary')
ok(imageOf(sheet) !== undefined, 'sheet returns an image')

// 9) frames mode is single-source by definition.
const badMode = await call('pixelcraft_sheet', { sources: [moving, moving], mode: 'frames' })
ok(badMode.isError === true, 'frames mode rejects multiple sources')

// 10) Schema validation is enforced by the protocol, not just by us. The SDK
// reports it as an error *result* (-32602) rather than throwing, so a caller
// sees it the same way it sees any other tool failure.
for (const [scale, label] of [
  [999, 'above the maximum'],
  [-3, 'negative'],
  [2.5, 'non-integer']
]) {
  const bad = await call('pixelcraft_render', { source: art, scale })
  ok(bad.isError === true, `a scale ${label} is rejected`)
  ok(
    textOf(bad).includes('validation error') && imageOf(bad) === undefined,
    `a scale ${label} never reaches the engine`
  )
}

await client.close()
console.log(failures === 0 ? '\nMCP SMOKE PASS' : `\nMCP SMOKE FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
