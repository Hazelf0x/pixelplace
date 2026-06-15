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
import { encodeCanvasToPng } from './headless/png-encoder'
import { buildAIPromptText } from './lang/docs-content'

// ---- Low-level re-exports (full engine access) -----------------------------
export { parse, compileProgram, formatSource, Interpreter, HeadlessPixelCanvas, encodeCanvasToPng }
export type { CompileError, RuntimeError, ProgramWarning }
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
