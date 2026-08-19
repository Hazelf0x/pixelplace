// @pixelplace/pixelcraft
// Public API for the PixelCraft DSL engine: parse, compile, render (headless).
// This is the native document format for PixelPlace posts. The same source a
// human's editor emits is the source Claude emits — both compile to identical pixels.

import { parse } from './lang/parser'
import { compileProgram, type CompileError } from './lang/compiler'
import { formatSource } from './lang/formatter'
import { Interpreter, type RuntimeError } from './runtime/interpreter'
import type { ProgramWarning } from './runtime/warning-analyzer'
import { HeadlessPixelCanvas } from './headless/headless-canvas'
import { encodeCanvasToPng, encodeRgbaToPng } from './headless/png-encoder'
import { captureFrame, encodeFramesToGif, type GifEncodeOptions } from './headless/gif-encoder'
import { canvasToRgba } from './headless/rgba'
import { buildAIPromptText } from './lang/docs-content'

// ---- Low-level re-exports (full engine access) -----------------------------
export { parse, compileProgram, formatSource, Interpreter, HeadlessPixelCanvas, encodeCanvasToPng }
export { encodeFramesToGif, encodeRgbaToPng, canvasToRgba }
export type { CompileError, RuntimeError, ProgramWarning, GifEncodeOptions }
export * from './lang/ast'

/**
 * The canonical PixelCraft authoring prompt, generated from the language's own
 * docs source. Use this as the system prompt when asking an LLM to write
 * PixelCraft — the model is instructed from the same source of truth as the
 * language itself, so it stays in sync as the DSL evolves.
 */
export function aiSystemPrompt(): string {
  return buildAIPromptText()
}

// ---- High-level diagnostics ------------------------------------------------
export interface Diagnostic {
  code: string
  message: string
  line: number
  column: number
  filePath?: string
  hint?: string
}

export interface RenderOptions {
  /** Frame index to render for animated programs. Defaults to 0. Ignored for static art. */
  frame?: number
  /** Integer upscale factor for the emitted PNG. Defaults to 1 (true pixel size). */
  scale?: number
  /** Entry path label used in diagnostics. Defaults to "post.pc". */
  entryPath?: string
}

export interface RenderResult {
  /** True when the program compiled and rendered with no errors. */
  ok: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
  /** PNG bytes for the requested frame. Present only when ok. */
  png?: Uint8Array
  width: number
  height: number
  hasAnimation: boolean
  frameCount: number
  /** Resolved palette colors (hex) after compilation — for editor swatches. */
  palette: string[]
}

function toDiag(e: CompileError | RuntimeError): Diagnostic {
  return {
    code: String(e.code),
    message: e.message,
    line: e.line,
    column: e.column,
    filePath: (e as CompileError).filePath
  }
}

function warnToDiag(w: ProgramWarning): Diagnostic {
  return { code: String(w.code), message: w.message, line: w.line, column: w.column, hint: w.hint }
}

/**
 * Compile and render a single-file PixelCraft program to a PNG, headlessly.
 *
 * This is the core server-side pipeline: it is what the AI refine loop calls
 * (compile -> read structured diagnostics -> render -> feed back), and what the
 * web app calls to produce post thumbnails. Deterministic: same source + frame
 * always yields identical bytes.
 */
export function renderSource(source: string, opts: RenderOptions = {}): RenderResult {
  const entryPath = opts.entryPath ?? 'post.pc'
  const frame = opts.frame ?? 0
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))

  const compiled = compileProgram({
    entryPath,
    readFile: (path) => (path === entryPath ? source : null)
  })

  if (compiled.errors.length > 0) {
    return {
      ok: false,
      errors: compiled.errors.map(toDiag),
      warnings: [],
      width: 0,
      height: 0,
      hasAnimation: false,
      frameCount: 0,
      palette: []
    }
  }

  const program = compiled.program
  const canvas = new HeadlessPixelCanvas()
  // Interpreter is canvas-agnostic (duck-typed); the headless canvas has no DOM deps.
  const interpreter = new Interpreter(canvas as unknown as never)

  const warnings = interpreter.analyzeWarnings(program).map(warnToDiag)
  const analysis = interpreter.analyzeProgram(program)

  const frameIndex = analysis.hasAnimation
    ? Math.min(Math.max(0, frame), Math.max(0, analysis.frameCount - 1))
    : 0

  const runtimeErrors = analysis.hasAnimation
    ? interpreter.execute(program, frameIndex)
    : interpreter.execute(program)

  const size = canvas.getSize()

  if (runtimeErrors.length > 0) {
    return {
      ok: false,
      errors: runtimeErrors.map(toDiag),
      warnings,
      width: size.width,
      height: size.height,
      hasAnimation: analysis.hasAnimation,
      frameCount: analysis.frameCount,
      palette: canvas.getPalette()
    }
  }

  return {
    ok: true,
    errors: [],
    warnings,
    png: encodeCanvasToPng(canvas, scale),
    width: size.width,
    height: size.height,
    hasAnimation: analysis.hasAnimation,
    frameCount: analysis.frameCount,
    palette: canvas.getPalette()
  }
}

/** Hard ceiling on frames we will encode, so a runaway timeline can't hang a request. */
export const MAX_ANIMATION_FRAMES = 240

export interface AnimationOptions extends GifEncodeOptions {
  /** Integer upscale factor for the emitted GIF. Defaults to 1 (true pixel size). */
  scale?: number
  /** Entry path label used in diagnostics. Defaults to "post.pc". */
  entryPath?: string
}

export interface AnimationResult {
  ok: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
  /** Animated GIF bytes. Present only when ok and the program actually animates. */
  gif?: Uint8Array
  width: number
  height: number
  hasAnimation: boolean
  /** Frames encoded (already expanded by each frame's declared duration). */
  frameCount: number
  fps: number
  palette: string[]
}

/**
 * Compile a PixelCraft program and render every frame into a single animated GIF.
 *
 * A program's `frame`/`frames`/`timeline` blocks are what make a post move, and
 * this is the only path that shows all of them — `renderSource` deliberately
 * renders one frame for thumbnails. One interpreter is reused across the whole
 * sequence so the preamble is executed once and restored per frame.
 */
export function renderAnimation(source: string, opts: AnimationOptions = {}): AnimationResult {
  const entryPath = opts.entryPath ?? 'post.pc'
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))

  const compiled = compileProgram({
    entryPath,
    readFile: (path) => (path === entryPath ? source : null)
  })

  const empty = {
    width: 0,
    height: 0,
    hasAnimation: false,
    frameCount: 0,
    fps: opts.fps ?? 12,
    palette: [] as string[]
  }

  if (compiled.errors.length > 0) {
    return { ok: false, errors: compiled.errors.map(toDiag), warnings: [], ...empty }
  }

  const program = compiled.program
  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)

  const warnings = interpreter.analyzeWarnings(program).map(warnToDiag)
  const analysis = interpreter.analyzeProgram(program)

  if (!analysis.hasAnimation) {
    // Not an error — a still program simply has no GIF to give.
    const errors = interpreter.execute(program).map(toDiag)
    const size = canvas.getSize()
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      ...empty,
      width: size.width,
      height: size.height,
      palette: canvas.getPalette()
    }
  }

  const frameCount = Math.min(analysis.frameCount, MAX_ANIMATION_FRAMES)
  const buffers: Uint8Array[] = []

  for (let i = 0; i < frameCount; i++) {
    const runtimeErrors = interpreter.execute(program, i)
    if (runtimeErrors.length > 0) {
      const size = canvas.getSize()
      return {
        ok: false,
        errors: runtimeErrors.map(toDiag),
        warnings,
        ...empty,
        width: size.width,
        height: size.height,
        hasAnimation: true,
        frameCount: analysis.frameCount,
        palette: canvas.getPalette()
      }
    }
    buffers.push(captureFrame(canvas, scale))
  }

  const size = canvas.getSize()
  const fps = Math.max(1, Math.min(50, opts.fps ?? 12))

  return {
    ok: true,
    errors: [],
    warnings,
    gif: encodeFramesToGif(buffers, size.width * scale, size.height * scale, {
      fps,
      repeat: opts.repeat
    }),
    width: size.width,
    height: size.height,
    hasAnimation: true,
    frameCount,
    fps,
    palette: canvas.getPalette()
  }
}

export interface SpriteSheetOptions {
  /** Integer upscale factor applied to each cell. Defaults to 1. */
  scale?: number
  /** Cells per row. Defaults to the frame count (a single strip). */
  columns?: number
  /** Entry path label used in diagnostics. Defaults to "post.pc". */
  entryPath?: string
}

export interface SpriteSheetResult {
  ok: boolean
  errors: Diagnostic[]
  /** The tiled PNG. Present only when ok. */
  png?: Uint8Array
  /** Cell dimensions, after scaling — what an importer needs to slice it. */
  frameWidth: number
  frameHeight: number
  frameCount: number
  columns: number
  rows: number
}

/**
 * Render every frame into one tiled PNG — the format game engines actually import.
 *
 * Cells are laid out left-to-right, top-to-bottom on an exact grid, so slicing by
 * frameWidth/frameHeight is guaranteed to line up. A still program yields a
 * single-cell sheet rather than an error.
 */
export function renderSpriteSheet(source: string, opts: SpriteSheetOptions = {}): SpriteSheetResult {
  const entryPath = opts.entryPath ?? 'post.pc'
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))

  const compiled = compileProgram({
    entryPath,
    readFile: (path) => (path === entryPath ? source : null)
  })

  const empty = { frameWidth: 0, frameHeight: 0, frameCount: 0, columns: 0, rows: 0 }

  if (compiled.errors.length > 0) {
    return { ok: false, errors: compiled.errors.map(toDiag), ...empty }
  }

  const program = compiled.program
  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)
  const analysis = interpreter.analyzeProgram(program)

  const frameCount = analysis.hasAnimation
    ? Math.min(analysis.frameCount, MAX_ANIMATION_FRAMES)
    : 1

  const cells: Uint8Array[] = []
  for (let i = 0; i < frameCount; i++) {
    const runtimeErrors = analysis.hasAnimation
      ? interpreter.execute(program, i)
      : interpreter.execute(program)
    if (runtimeErrors.length > 0) {
      return { ok: false, errors: runtimeErrors.map(toDiag), ...empty }
    }
    cells.push(canvasToRgba(canvas, scale))
  }

  const size = canvas.getSize()
  const frameWidth = size.width * scale
  const frameHeight = size.height * scale
  const columns = Math.max(1, Math.min(frameCount, Math.floor(opts.columns ?? frameCount)))
  const rows = Math.ceil(frameCount / columns)

  const sheetWidth = frameWidth * columns
  const sheetHeight = frameHeight * rows
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4)

  cells.forEach((cell, index) => {
    const originX = (index % columns) * frameWidth
    const originY = Math.floor(index / columns) * frameHeight
    for (let y = 0; y < frameHeight; y++) {
      const from = y * frameWidth * 4
      const to = ((originY + y) * sheetWidth + originX) * 4
      sheet.set(cell.subarray(from, from + frameWidth * 4), to)
    }
  })

  return {
    ok: true,
    errors: [],
    png: encodeRgbaToPng(sheet, sheetWidth, sheetHeight),
    frameWidth,
    frameHeight,
    frameCount,
    columns,
    rows
  }
}

export interface SetSheetOptions {
  /** Integer upscale factor applied to each cell. Defaults to 1. */
  scale?: number
  /** Cells per row. Defaults to the member count (a single strip). */
  columns?: number
  /** Frame to render from each member. Defaults to 0. */
  frame?: number
}

export interface SetSheetResult {
  ok: boolean
  errors: Diagnostic[]
  png?: Uint8Array
  /** Cell size after scaling — every member is padded to this, so the grid is uniform. */
  frameWidth: number
  frameHeight: number
  memberCount: number
  columns: number
  rows: number
}

/**
 * Tile several *different* programs into one sheet — an icon set, a character's
 * facings, a family of items.
 *
 * Distinct from {@link renderSpriteSheet}, which tiles the frames of one program.
 * Members may declare different canvas sizes; each cell is padded to the largest
 * and the art centered inside it, so the grid stays uniform and sliceable even
 * when the set is not perfectly consistent.
 */
export function renderSetSheet(sources: string[], opts: SetSheetOptions = {}): SetSheetResult {
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))
  const frame = Math.max(0, Math.floor(opts.frame ?? 0))
  const empty = { frameWidth: 0, frameHeight: 0, memberCount: 0, columns: 0, rows: 0 }

  if (sources.length === 0) {
    return { ok: false, errors: [], ...empty }
  }

  // Render each member once, at scale, keeping its raw pixels for compositing.
  const rendered: { rgba: Uint8Array; width: number; height: number }[] = []
  for (const source of sources) {
    const compiled = compileProgram({
      entryPath: 'member.pc',
      readFile: (path) => (path === 'member.pc' ? source : null)
    })
    if (compiled.errors.length > 0) {
      return { ok: false, errors: compiled.errors.map(toDiag), ...empty }
    }

    const canvas = new HeadlessPixelCanvas()
    const interpreter = new Interpreter(canvas as unknown as never)
    const analysis = interpreter.analyzeProgram(compiled.program)
    const runtimeErrors = analysis.hasAnimation
      ? interpreter.execute(compiled.program, Math.min(frame, Math.max(0, analysis.frameCount - 1)))
      : interpreter.execute(compiled.program)
    if (runtimeErrors.length > 0) {
      return { ok: false, errors: runtimeErrors.map(toDiag), ...empty }
    }

    const size = canvas.getSize()
    rendered.push({
      rgba: canvasToRgba(canvas, scale),
      width: size.width * scale,
      height: size.height * scale
    })
  }

  const frameWidth = Math.max(...rendered.map((r) => r.width))
  const frameHeight = Math.max(...rendered.map((r) => r.height))
  const columns = Math.max(1, Math.min(rendered.length, Math.floor(opts.columns ?? rendered.length)))
  const rows = Math.ceil(rendered.length / columns)

  const sheetWidth = frameWidth * columns
  const sheetHeight = frameHeight * rows
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4)

  rendered.forEach((member, index) => {
    // Centre undersized members in their cell so the grid reads evenly.
    const padX = Math.floor((frameWidth - member.width) / 2)
    const padY = Math.floor((frameHeight - member.height) / 2)
    const originX = (index % columns) * frameWidth + padX
    const originY = Math.floor(index / columns) * frameHeight + padY

    for (let y = 0; y < member.height; y++) {
      const from = y * member.width * 4
      const to = ((originY + y) * sheetWidth + originX) * 4
      sheet.set(member.rgba.subarray(from, from + member.width * 4), to)
    }
  })

  return {
    ok: true,
    errors: [],
    png: encodeRgbaToPng(sheet, sheetWidth, sheetHeight),
    frameWidth,
    frameHeight,
    memberCount: rendered.length,
    columns,
    rows
  }
}

/**
 * The distinct colors a program actually paints, as lowercase #rrggbbaa.
 *
 * Deliberately different from a render's `palette`, which is what the program
 * *declared*. A model can declare the palette it was given and still paint an
 * inline hex literal, so anything enforcing a locked palette has to look at
 * pixels, not declarations. Fully transparent pixels are not colors and are
 * excluded.
 */
export function extractUsedColors(source: string, opts: RenderOptions = {}): string[] {
  const entryPath = opts.entryPath ?? 'post.pc'
  const compiled = compileProgram({
    entryPath,
    readFile: (path) => (path === entryPath ? source : null)
  })
  if (compiled.errors.length > 0) return []

  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)
  const analysis = interpreter.analyzeProgram(compiled.program)

  const used = new Set<string>()
  const frameCount = analysis.hasAnimation ? Math.min(analysis.frameCount, MAX_ANIMATION_FRAMES) : 1

  for (let i = 0; i < frameCount; i++) {
    const errors = analysis.hasAnimation
      ? interpreter.execute(compiled.program, i)
      : interpreter.execute(compiled.program)
    if (errors.length > 0) return []

    const rgba = canvasToRgba(canvas, 1)
    for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p + 3] === 0) continue
      used.add(
        `#${rgba[p].toString(16).padStart(2, '0')}${rgba[p + 1].toString(16).padStart(2, '0')}` +
          `${rgba[p + 2].toString(16).padStart(2, '0')}${rgba[p + 3].toString(16).padStart(2, '0')}`
      )
    }
  }

  return [...used].sort()
}

export interface CoverageResult {
  /** Pixels with any opacity, on the first rendered frame. */
  painted: number
  /** Total pixels on the canvas. */
  total: number
  /** painted / total, 0..1. */
  ratio: number
}

/**
 * How much of the canvas a program actually paints.
 *
 * Useful for checking a stated constraint rather than taste: an asset told to
 * leave its background transparent and draw only the subject cannot legitimately
 * cover the entire canvas, so a ratio of 1 means the instruction was ignored.
 */
export function measureCoverage(source: string, opts: RenderOptions = {}): CoverageResult {
  const entryPath = opts.entryPath ?? 'post.pc'
  const compiled = compileProgram({
    entryPath,
    readFile: (path) => (path === entryPath ? source : null)
  })
  const none = { painted: 0, total: 0, ratio: 0 }
  if (compiled.errors.length > 0) return none

  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)
  const analysis = interpreter.analyzeProgram(compiled.program)

  const errors = analysis.hasAnimation
    ? interpreter.execute(compiled.program, Math.max(0, Math.min(opts.frame ?? 0, analysis.frameCount - 1)))
    : interpreter.execute(compiled.program)
  if (errors.length > 0) return none

  const rgba = canvasToRgba(canvas, 1)
  const size = canvas.getSize()
  let painted = 0
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] !== 0) painted++
  }

  const total = size.width * size.height
  return { painted, total, ratio: total === 0 ? 0 : painted / total }
}

/** Ceiling on replay steps, so a huge program can't produce an unbounded payload. */
export const MAX_REPLAY_STEPS = 300

export interface ReplayOptions {
  /** Integer upscale factor for each step's PNG. Defaults to 1. */
  scale?: number
  /** For animated programs, which frame's construction to replay. Defaults to 0. */
  frame?: number
  /** Entry path label used in diagnostics. Defaults to "post.pc". */
  entryPath?: string
}

export interface ReplayStep {
  /** 0-based position in the replay. */
  index: number
  /** 1-based source line of the statement that produced this state. */
  line: number
  /** 1-based source column of that statement. */
  column: number
  /** The statement's source text, trimmed — what to show alongside the frame. */
  text: string
  /** The canvas as it stands after this statement, as a data-URL PNG. */
  png: string
}

export interface ReplayResult {
  ok: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
  width: number
  height: number
  palette: string[]
  /** Ordered construction steps. Empty when the program failed to run. */
  steps: ReplayStep[]
  /** True when the program had more visible steps than MAX_REPLAY_STEPS. */
  truncated: boolean
}

/**
 * Replay a program's construction: render the canvas after every statement that
 * changes it, in source order.
 *
 * This is the thing a bitmap cannot do. A PixelCraft post is a recipe, not a
 * picture, so we can show it being followed — each step paired with the line of
 * source that caused it. Statements that only declare (canvas, pal, let, box)
 * change no pixels and are skipped automatically: a step is defined by whether
 * the rendered image actually differs, not by a hardcoded list of commands.
 *
 * Single pass: an observer on the interpreter captures state between statements,
 * so this costs one execution plus one encode per visible step.
 */
export function renderReplay(source: string, opts: ReplayOptions = {}): ReplayResult {
  const entryPath = opts.entryPath ?? 'post.pc'
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))

  const compiled = compileProgram({
    entryPath,
    readFile: (path) => (path === entryPath ? source : null)
  })

  if (compiled.errors.length > 0) {
    return {
      ok: false,
      errors: compiled.errors.map(toDiag),
      warnings: [],
      width: 0,
      height: 0,
      palette: [],
      steps: [],
      truncated: false
    }
  }

  const program = compiled.program
  const canvas = new HeadlessPixelCanvas()
  const interpreter = new Interpreter(canvas as unknown as never)

  const warnings = interpreter.analyzeWarnings(program).map(warnToDiag)
  const analysis = interpreter.analyzeProgram(program)

  const sourceLines = source.split(/\r?\n/)
  const steps: ReplayStep[] = []
  let previous: string | null = null
  let truncated = false

  interpreter.setStepObserver((node) => {
    if (steps.length >= MAX_REPLAY_STEPS) {
      truncated = true
      return
    }

    // Compare encoded bytes rather than guessing which commands paint: a
    // statement earns a step only if it actually changed the picture.
    const png = encodeCanvasToPng(canvas, scale)
    const encoded = Buffer.from(png).toString('base64')
    if (encoded === previous) return
    previous = encoded

    steps.push({
      index: steps.length,
      line: node.pos.line,
      column: node.pos.column,
      text: (sourceLines[node.pos.line - 1] ?? '').trim(),
      png: `data:image/png;base64,${encoded}`
    })
  })

  const frameIndex = analysis.hasAnimation
    ? Math.min(Math.max(0, opts.frame ?? 0), Math.max(0, analysis.frameCount - 1))
    : undefined

  const runtimeErrors = interpreter.execute(program, frameIndex)
  interpreter.setStepObserver(null)

  const size = canvas.getSize()

  return {
    ok: runtimeErrors.length === 0,
    errors: runtimeErrors.map(toDiag),
    warnings,
    width: size.width,
    height: size.height,
    palette: canvas.getPalette(),
    steps,
    truncated
  }
}

/**
 * Compile without rendering — for fast validation (e.g. the AI loop's first
 * pass, or rejecting an invalid post before it is stored). Returns structured
 * diagnostics with stable PixelCraft error codes.
 */
export function validateSource(source: string, entryPath = 'post.pc'): { ok: boolean; errors: Diagnostic[] } {
  const compiled = compileProgram({
    entryPath,
    readFile: (path) => (path === entryPath ? source : null)
  })
  return { ok: compiled.errors.length === 0, errors: compiled.errors.map(toDiag) }
}
