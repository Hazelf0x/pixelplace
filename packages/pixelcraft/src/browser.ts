// @pixelplace/pixelcraft/browser
//
// The whole engine, minus the one thing a browser does not need: PNG encoding.
//
// `headless/png-encoder` calls require('node:zlib') at module scope, so importing
// the main entry from client code breaks the bundle. Nothing else in lang/ or
// runtime/ touches Node — the compiler, interpreter and canvas are pure TypeScript.
// So this entry re-exports all of it and stops at raw RGBA, which is exactly what
// `ctx.putImageData` wants. A browser that needs a PNG has `canvas.toBlob()`, which
// is faster than anything we would ship anyway.
//
// The point: a page importing this compiles and renders PixelCraft entirely on the
// client. No server sees the art, and no round trip sits between typing and pixels.
import { parse } from './lang/parser'
import { compileProgram, type CompileError } from './lang/compiler'
import { formatSource } from './lang/formatter'
import { Interpreter, type RuntimeError } from './runtime/interpreter'
import type { ProgramWarning } from './runtime/warning-analyzer'
import { HeadlessPixelCanvas } from './headless/headless-canvas'
import { canvasToRgba } from './headless/rgba'
import { encodeFramesToGif, type GifEncodeOptions } from './headless/gif-encoder'
import { buildAIPromptText } from './lang/docs-content'

export { parse, compileProgram, formatSource, Interpreter, HeadlessPixelCanvas, canvasToRgba }
export { encodeFramesToGif }
// The compiler's own lexer, so anything that highlights PixelCraft on the site
// tokenises it exactly the way the compiler does. A hand-written highlighter can
// disagree with what actually compiles; this one structurally cannot.
export { tokenize } from './lang/lexer'
export type { Token, TokenType } from './lang/lexer'
export type { CompileError, RuntimeError, ProgramWarning, GifEncodeOptions }
export * from './lang/ast'

/** The authoring guide, generated from the language's own docs so it cannot drift. */
export function aiSystemPrompt(): string {
  return buildAIPromptText()
}

/** A compile or runtime problem, flattened to the shape UI and tools both want. */
export interface Diagnostic {
  code: string
  message: string
  line: number
  column: number
  hint?: string
}

const toDiagnostic = (e: CompileError | RuntimeError | ProgramWarning): Diagnostic => ({
  code: e.code,
  message: e.message,
  line: 'line' in e && typeof e.line === 'number' ? e.line : 0,
  column: 'column' in e && typeof e.column === 'number' ? e.column : 0,
  ...('hint' in e && e.hint ? { hint: e.hint } : {})
})

const ENTRY = 'work.pc'

function compile(source: string) {
  return compileProgram({
    entryPath: ENTRY,
    readFile: (path) => (path === ENTRY ? source : null)
  })
}

export interface BrowserRenderOptions {
  /** Frame to render, for animated programs. Defaults to 0. */
  frame?: number
  /** Integer upscale. Defaults to 1 — scale with CSS instead, it stays crisp. */
  scale?: number
}

export interface BrowserRenderResult {
  ok: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
  /** Straight RGBA, ready for `new ImageData(...)`. Empty when the program failed. */
  rgba: Uint8Array
  /** Pixel dimensions of `rgba`, i.e. canvas size times scale. */
  width: number
  height: number
  /** The program's own canvas size, before scaling. */
  sourceWidth: number
  sourceHeight: number
  hasAnimation: boolean
  frameCount: number
  /** Colors the program DECLARED. What it actually painted can differ. */
  palette: string[]
}

const EMPTY: BrowserRenderResult = {
  ok: false,
  errors: [],
  warnings: [],
  rgba: new Uint8Array(0),
  width: 0,
  height: 0,
  sourceWidth: 0,
  sourceHeight: 0,
  hasAnimation: false,
  frameCount: 0,
  palette: []
}

/**
 * Compile and render one frame to RGBA.
 *
 * Mirrors `renderSource` from the Node entry, except it stops before the encoder:
 * the caller paints the buffer into a canvas rather than decoding a PNG.
 */
export function renderToRgba(source: string, opts: BrowserRenderOptions = {}): BrowserRenderResult {
  const compiled = compile(source)
  if (compiled.errors.length > 0) {
    return { ...EMPTY, errors: compiled.errors.map(toDiagnostic) }
  }

  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)
  const analysis = interpreter.analyzeProgram(compiled.program)
  const warnings = interpreter.analyzeWarnings(compiled.program).map(toDiagnostic)

  const frameCount = analysis.hasAnimation ? analysis.frameCount : 0
  const frame = analysis.hasAnimation
    ? Math.max(0, Math.min(Math.floor(opts.frame ?? 0), frameCount - 1))
    : 0

  const runtimeErrors = analysis.hasAnimation
    ? interpreter.execute(compiled.program, frame)
    : interpreter.execute(compiled.program)

  if (runtimeErrors.length > 0) {
    return { ...EMPTY, warnings, errors: runtimeErrors.map(toDiagnostic) }
  }

  const scale = Math.max(1, Math.floor(opts.scale ?? 1))
  const size = canvas.getSize()

  return {
    ok: true,
    errors: [],
    warnings,
    rgba: canvasToRgba(canvas, scale),
    width: size.width * scale,
    height: size.height * scale,
    sourceWidth: size.width,
    sourceHeight: size.height,
    hasAnimation: analysis.hasAnimation,
    frameCount,
    palette: canvas.getPalette()
  }
}

/** Compile without rendering. Cheap enough to run on every keystroke. */
export function validateSource(source: string): { ok: boolean; errors: Diagnostic[] } {
  const compiled = compile(source)
  return { ok: compiled.errors.length === 0, errors: compiled.errors.map(toDiagnostic) }
}

/** Ceiling on frames we will walk, matching the Node entry. */
export const MAX_ANIMATION_FRAMES = 240

/**
 * Every frame of an animated program, as RGBA buffers.
 *
 * One interpreter is reused across frames so the preamble snapshot cache applies,
 * exactly as the GIF encoder does it.
 */
export function renderFramesToRgba(
  source: string,
  opts: BrowserRenderOptions = {}
): { ok: boolean; errors: Diagnostic[]; frames: Uint8Array[]; width: number; height: number } {
  const compiled = compile(source)
  if (compiled.errors.length > 0) {
    return { ok: false, errors: compiled.errors.map(toDiagnostic), frames: [], width: 0, height: 0 }
  }

  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)
  const analysis = interpreter.analyzeProgram(compiled.program)
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))
  const count = analysis.hasAnimation ? Math.min(analysis.frameCount, MAX_ANIMATION_FRAMES) : 1

  const frames: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const errors = analysis.hasAnimation
      ? interpreter.execute(compiled.program, i)
      : interpreter.execute(compiled.program)
    if (errors.length > 0) {
      return { ok: false, errors: errors.map(toDiagnostic), frames: [], width: 0, height: 0 }
    }
    frames.push(canvasToRgba(canvas, scale))
  }

  const size = canvas.getSize()
  return { ok: true, errors: [], frames, width: size.width * scale, height: size.height * scale }
}

const toHex8 = (r: number, g: number, b: number, a: number): string =>
  `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}` +
  `${b.toString(16).padStart(2, '0')}${a.toString(16).padStart(2, '0')}`

/**
 * The distinct colors a program actually PAINTS, across every frame.
 *
 * Deliberately different from a render's `palette`, which is only what was
 * declared: a program can declare the palette it was handed and still paint an
 * inline hex literal, so anything enforcing a locked palette must read pixels.
 */
export function extractUsedColors(source: string): string[] {
  const result = renderFramesToRgba(source)
  if (!result.ok) return []

  const used = new Set<string>()
  for (const frame of result.frames) {
    for (let p = 0; p < frame.length; p += 4) {
      if (frame[p + 3] === 0) continue
      used.add(toHex8(frame[p], frame[p + 1], frame[p + 2], frame[p + 3]))
    }
  }
  return [...used].sort()
}

export interface CoverageResult {
  painted: number
  total: number
  ratio: number
  /** Highest ratio reached by any frame; equals `ratio` for a still program. */
  maxRatio: number
  framesInspected: number
}

/**
 * How much of the canvas a program paints.
 *
 * Checks a stated constraint rather than taste: something told to leave its
 * background transparent cannot legitimately cover the whole canvas. Measured on
 * every frame, because one frame is not evidence about the others.
 */
export function measureCoverage(source: string, opts: BrowserRenderOptions = {}): CoverageResult {
  const none = { painted: 0, total: 0, ratio: 0, maxRatio: 0, framesInspected: 0 }
  const result = renderFramesToRgba(source)
  if (!result.ok || result.frames.length === 0) return none

  const total = result.width * result.height
  const inspected = Math.max(0, Math.min(Math.floor(opts.frame ?? 0), result.frames.length - 1))

  let painted = 0
  let maxPainted = 0
  result.frames.forEach((frame, index) => {
    let count = 0
    for (let p = 3; p < frame.length; p += 4) if (frame[p] !== 0) count++
    if (index === inspected) painted = count
    if (count > maxPainted) maxPainted = count
  })

  return {
    painted,
    total,
    ratio: total === 0 ? 0 : painted / total,
    maxRatio: total === 0 ? 0 : maxPainted / total,
    framesInspected: result.frames.length
  }
}

/**
 * Encode an animated program straight to GIF bytes, in the browser.
 *
 * gifenc is pure JavaScript, so the one piece of export that a browser cannot do
 * natively still runs client-side. PNG export needs nothing from us at all —
 * `canvas.toBlob("image/png")` is built in and faster than anything we would ship.
 */
export function renderGif(
  source: string,
  opts: BrowserRenderOptions & GifEncodeOptions = {}
): { ok: boolean; errors: Diagnostic[]; gif: Uint8Array; frameCount: number; width: number; height: number } {
  const result = renderFramesToRgba(source, opts)
  if (!result.ok || result.frames.length === 0) {
    return { ok: false, errors: result.errors, gif: new Uint8Array(0), frameCount: 0, width: 0, height: 0 }
  }
  return {
    ok: true,
    errors: [],
    gif: encodeFramesToGif(result.frames, result.width, result.height, opts),
    frameCount: result.frames.length,
    width: result.width,
    height: result.height
  }
}


/** Cap on replay steps, matching the Node entry. */
export const MAX_REPLAY_STEPS = 300

export interface BrowserReplayStep {
  index: number
  /** 1-based line in the source that produced this step. */
  line: number
  column: number
  /** That line, trimmed — enough to caption the step without re-reading the source. */
  text: string
  /** The canvas as it stood after this statement ran. */
  rgba: Uint8Array
}

export interface BrowserReplayResult {
  ok: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  palette: string[]
  steps: BrowserReplayStep[]
  /** True when the program had more visible steps than MAX_REPLAY_STEPS. */
  truncated: boolean
}

const EMPTY_REPLAY: BrowserReplayResult = {
  ok: false,
  errors: [],
  warnings: [],
  width: 0,
  height: 0,
  sourceWidth: 0,
  sourceHeight: 0,
  palette: [],
  steps: [],
  truncated: false
}

/**
 * Replay a program's construction, one visible change at a time.
 *
 * The browser twin of `renderReplay` in the Node entry, stopping at RGBA rather
 * than encoding a PNG per step. Two things make this a single pass instead of
 * re-executing the program N times: drawing accumulates in LAYERS and reaches the
 * canvas only through `compositeLayersToCanvas`, so reading the canvas mid-run
 * cannot affect what the program does.
 *
 * A statement earns a step only when the pixels actually change — compared here by
 * bytes, exactly as the Node version compares encoded PNGs. Declarations therefore
 * drop out on their own, and the rule stays correct as the language grows.
 */
export function renderReplayToRgba(
  source: string,
  opts: { frame?: number } = {}
): BrowserReplayResult {
  const compiled = compile(source)
  if (compiled.errors.length > 0) {
    return { ...EMPTY_REPLAY, errors: compiled.errors.map(toDiagnostic) }
  }

  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)
  const warnings = interpreter.analyzeWarnings(compiled.program).map(toDiagnostic)
  const analysis = interpreter.analyzeProgram(compiled.program)

  const sourceLines = source.split(/\r?\n/)
  const steps: BrowserReplayStep[] = []
  let previous: Uint8Array | null = null
  let truncated = false

  interpreter.setStepObserver((node) => {
    if (steps.length >= MAX_REPLAY_STEPS) {
      truncated = true
      return
    }

    const rgba = canvasToRgba(canvas, 1)
    if (previous && rgba.length === previous.length) {
      let same = true
      for (let i = 0; i < rgba.length; i++) {
        if (rgba[i] !== previous[i]) {
          same = false
          break
        }
      }
      if (same) return
    }
    previous = rgba

    steps.push({
      index: steps.length,
      line: node.pos.line,
      column: node.pos.column,
      text: (sourceLines[node.pos.line - 1] ?? '').trim(),
      rgba
    })
  })

  const frameIndex = analysis.hasAnimation
    ? Math.min(Math.max(0, opts.frame ?? 0), Math.max(0, analysis.frameCount - 1))
    : undefined

  const runtimeErrors = interpreter.execute(compiled.program, frameIndex)
  interpreter.setStepObserver(null)

  const size = canvas.getSize()

  return {
    ok: runtimeErrors.length === 0,
    errors: runtimeErrors.map(toDiagnostic),
    warnings,
    width: size.width,
    height: size.height,
    sourceWidth: size.width,
    sourceHeight: size.height,
    palette: canvas.getPalette(),
    steps,
    truncated
  }
}
