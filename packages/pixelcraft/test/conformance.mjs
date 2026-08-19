// Conformance: does this engine still behave like the PixelCraft it was extracted from?
//
// packages/pixelcraft began as a copy of CodingArt/src/{lang,runtime}, taken on the
// assumption that the semantics were frozen. They were not. CodingArt gained `pow`,
// `offset` and `fade`, and the two newest showcase programs — the best answers to
// "what is this language for?" — silently stopped compiling here. Nothing noticed,
// because nothing was checking.
//
// This checks three things the smoke test cannot:
//   1. Every upstream example still compiles and renders. That is 58 real programs
//      exercising far more of the grammar than any test written by hand.
//   2. Rendering reproduces upstream's own reference PNGs byte for byte.
//   3. The shared source files have not drifted apart again.
//
// Upstream is a sibling checkout, not a dependency, so this skips cleanly when it is
// absent rather than failing a build that has nothing wrong with it.
import { renderSource } from '../dist/index.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const UPSTREAM = process.env.PIXELCRAFT_UPSTREAM ?? 'C:/ClaudeProjects/CodingArt'
const EXAMPLES = join(UPSTREAM, 'examples')

if (!existsSync(EXAMPLES)) {
  console.log(`CONFORMANCE SKIPPED — no upstream checkout at ${UPSTREAM}`)
  console.log('Set PIXELCRAFT_UPSTREAM to point at it.')
  process.exit(0)
}

let failures = 0
const ok = (cond, label) => {
  if (!cond) failures++
  console.log(`  ${cond ? 'ok ' : 'FAIL'}  - ${label}`)
}

// 1) Every upstream example compiles and renders.
const examples = readdirSync(EXAMPLES).filter((f) => f.endsWith('.txt')).sort()
const broken = []
for (const file of examples) {
  const result = renderSource(readFileSync(join(EXAMPLES, file), 'utf8'))
  if (!result.ok) {
    broken.push(`${file}: ${result.errors.slice(0, 2).map((e) => `${e.code} ${e.message}`).join('; ')}`)
  }
}
console.log(`\n${examples.length} upstream examples:`)
ok(examples.length >= 50, `the corpus is present (${examples.length} programs)`)
ok(broken.length === 0, `all render${broken.length ? `\n        ${broken.join('\n        ')}` : ''}`)

// 2) Reproduce upstream's own reference PNGs byte for byte. This is the real proof
// the port is faithful: not "it compiles" but "it produces the identical image".
// Each frame is the one that preview was captured at.
console.log('\nreference images reproduce byte-for-byte:')
for (const [name, frame, scale] of [['opus5_deep_field', 0, 8], ['fable_ink_sea_v2', 14, 8]]) {
  const preview = join(EXAMPLES, `${name}_preview.png`)
  if (!existsSync(preview)) {
    console.log(`  skip  - ${name} (no reference image)`)
    continue
  }
  const rendered = renderSource(readFileSync(join(EXAMPLES, `${name}.txt`), 'utf8'), { frame, scale })
  ok(
    rendered.ok && Buffer.from(rendered.png, 'base64').equals(readFileSync(preview)),
    `${name} frame ${frame} at ${scale}x`
  )
}

// 3) The shared language sources have not drifted apart again.
const SHARED = [
  'lang/ast.ts',
  'lang/command-registry.ts',
  'lang/expression-intrinsics.ts',
  'lang/parser.ts',
  'lang/semantic-lowering.ts',
  'lang/semantic-validation.ts',
  'lang/docs-content.ts',
  'runtime/interpreter.ts',
  'runtime/warning-analyzer.ts'
]

// warning-analyzer.ts is deliberately ahead of upstream, so it cannot be compared
// line-for-line. Both sides independently fixed W014 firing on expression-driven
// animation; upstream goes silent whenever geometry is dynamic, this engine binds
// the frame built-ins and evaluates the expressions instead, so the warning stays
// able to fire on frames that really do not move. Every upstream line missing here
// must belong to that one disagreement — anything else is drift that needs porting.
const SUPERSEDED = {
  'runtime/warning-analyzer.ts': [
    /hasDynamicGeometry/,
    /analyzeFrameBody/,
    /entry\.metrics\.bbox !== null\) &&$/,
    /^case 'var':$/,
    /^return evalStaticExpr\(value\)$/,
    /isCenter \|\| .*isRelative.*return null$/,
    // bail-outs this engine rewrote to record the miss before returning
    /^if \(!(center|origin|p1|staticPoint)/,
    /^(continue|return|bbox|drawCommands\+\+|\}|\{)$/
  ]
}

console.log('\nshared sources vs upstream:')
const lines = (text) => text.replace(/\r\n/g, '\n').split('\n')
for (const rel of SHARED) {
  const theirs = join(UPSTREAM, 'src', rel)
  if (!existsSync(theirs)) continue
  const upstream = lines(readFileSync(theirs, 'utf8'))
  const ours = new Set(lines(readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')).map((l) => l.trim()))
  const allowed = SUPERSEDED[rel] ?? []
  const missing = upstream
    .map((line) => line.trim())
    .filter((line) => line !== '' && !ours.has(line))
    .filter((line) => !allowed.some((pattern) => pattern.test(line)))
  ok(
    missing.length === 0,
    `${rel}${missing.length ? ` — ${missing.length} upstream line(s) absent, e.g. ${JSON.stringify(missing[0].slice(0, 70))}` : ''}`
  )
}

console.log(failures === 0 ? '\nCONFORMANCE PASS' : `\nCONFORMANCE FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
