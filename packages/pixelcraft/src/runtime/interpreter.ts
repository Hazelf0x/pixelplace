import {
  Program,
  ASTNode,
  MirrorAxis,
  Color,
  ResolvedColor,
  FrameNode,
  Point,
  TileNode,
  TilesetNode,
  TilemapNode,
  MapNode,
  ScatterNode,
  EmitNode,
  ScalarValue,
  Expr,
  SourceSpan,
  FontNode,
  TextNode,
  DitherNode,
  BoxPointSelector
} from '../lang/ast'
import { evaluateExpressionIntrinsic, hashCoordsToUnit } from '../lang/expression-intrinsics'
import { PixelCanvas } from './canvas'
import { analyzeProgramWarnings } from './warning-analyzer'
import type { ProgramWarning } from './warning-analyzer'
import { isTransparentHexColorLiteral, isValidHexColorLiteral, parseHexColorLiteral } from '../lang/hex-color'
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  MAX_CANVAS_DIMENSION,
  MIN_CANVAS_DIMENSION,
  isCanvasDimensionValid
} from '../canvas-limits'

export interface RuntimeError {
  code: RuntimeErrorCode
  message: string
  line: number
  column: number
  filePath?: string
}

export interface PixelTrace {
  line: number
  column: number
  command: string
  layer: string
  filePath?: string
  sourceSpan?: SourceSpan
}

export type RuntimeErrorCode =
  | 'R001' // missing canvas command
  | 'R002' // state stack underflow
  | 'R003' // unknown variable
  | 'R004' // division by zero
  | 'R005' // modulo by zero
  | 'R006' // non-finite expression result
  | 'R007' // unknown anchor
  | 'R008' // no current color set
  | 'R009' // unknown color name
  | 'R010' // palette index out of range
  | 'R011' // unknown stamp/tile/map target
  | 'R012' // render draw budget exceeded
  | 'R013' // unknown font
  | 'R014' // missing glyph
  | 'R015' // invalid hex literal
  | 'R016' // invalid canvas dimensions
  | 'R017' // scalar clamp diagnostic
  | 'R018' // gradient steps clamp
  | 'R019' // frame built-in redefinition
  | 'R020' // expected color argument
  | 'R021' // tile size must be > 0
  | 'R022' // tile step required for group stamp
  | 'R023' // bitmap has no size
  | 'R024' // tile step must be > 0
  | 'R025' // emit fade requires bounded window
  | 'R026' // unexpected runtime exception
  | 'R027' // unknown tilemap
  | 'R028' // unknown tileset
  | 'R029' // unknown tileset symbol in tilemap
  | 'R030' // tile size in tileset must be > 0
  | 'R031' // compile-stage declaration/include reached runtime
  | 'R032' // :pivot used on a target without a declared pivot
  | 'R033' // unknown box
  | 'R034' // invalid box size

export type { ProgramWarning, WarningCode } from './warning-analyzer'

export interface ProgramAnalysis {
  preamble: ASTNode[]
  frames: FrameNode[]
  hasAnimation: boolean
  frameCount: number
  frameNumbers: number[]
}

export interface PaletteSlot {
  index: number
  hex: string
  name?: string
  presetName?: string
  presetColorIndex?: number
  sourceSpan?: SourceSpan
  hexSpan?: SourceSpan
  hexEndSpan?: SourceSpan
  stepsSpan?: SourceSpan
  isGradientDerived: boolean
  gradientStepIndex?: number
  gradientSteps?: number
}

interface PreambleState {
  mirrorX: boolean
  mirrorY: boolean
  hasCurrentColor: boolean
  currentColor: ResolvedColor
  unknownColorNames: Set<string>
  invalidPaletteIndexes: Set<string>
  bitmaps: Map<string, RuntimeBitmap>
  tilesets: Map<string, RuntimeTileset>
  tilemaps: Map<string, RuntimeTilemap>
  anchors: Map<string, { x: number; y: number }>
  boxes: Map<string, RuntimeBox>
  offsetX: number
  offsetY: number
  cursorX: number
  cursorY: number
  layers: Map<string, LayerPixels>
  layerTraces: Map<string, LayerPixelTraces>
  layerOrder: string[]
  activeLayerName: string
  stateStack: StackState[]
  variableScopes: Array<Map<string, number>>
}

interface SnapshotCanvas {
  captureSnapshot: () => unknown
  restoreSnapshot: (snapshot: unknown) => void
}

type LayerPixels = Map<string, ResolvedColor>
type LayerPixelTraces = Map<string, PixelTrace>

interface RuntimeFontGlyph {
  advance: number
  rows: string[]
  width: number
  height: number
}

interface RuntimeFont {
  name: string
  glyphs: Map<string, RuntimeFontGlyph>
  fallbackGlyph?: RuntimeFontGlyph
  defaultLineHeight: number
  defaultSpaceAdvance: number
}

interface RuntimeTileset {
  tileWidth: number
  tileHeight: number
  seed: number
  symbols: Map<string, RuntimeTilesetVariant[]>
}

interface RuntimeTilesetVariant {
  target: string
  weight: number
}

interface RuntimeBitmap {
  rows: string[]
  colorMap?: Record<string, string>
  pivot?: { x: ScalarValue; y: ScalarValue }
}

interface RuntimeGroup {
  body: ASTNode[]
  pivot?: { x: ScalarValue; y: ScalarValue }
}

interface RuntimeTilemap {
  tilesetName: string
  rows: string[]
}

interface RuntimeBox {
  x: number
  y: number
  width: number
  height: number
}

interface ResolvedBitmapPixel {
  x: number
  y: number
  color: ResolvedColor
}

interface ResolvedBitmapStamp {
  width: number
  height: number
  pixels: ResolvedBitmapPixel[]
}

interface StackState {
  mirrorX: boolean
  mirrorY: boolean
  hasCurrentColor: boolean
  currentColor: ResolvedColor
  offsetX: number
  offsetY: number
  cursorX: number
  cursorY: number
  activeLayerName: string
}

const MAX_ABS_COORD = MAX_CANVAS_DIMENSION * 8
const MAX_EXTENT = MAX_CANVAS_DIMENSION
const MAX_REPEAT_COUNT = 4096
const MAX_SCATTER_COUNT = 8192
const MAX_EMIT_COUNT = 8192
const MAX_GRADIENT_STEPS = 256
const MAX_FRAME_DURATION = 600
const MAX_DRAW_OPERATIONS = MAX_CANVAS_DIMENSION * MAX_CANVAS_DIMENSION * 64
const FRAME_BUILTIN_VAR_NAMES = new Set(['frame', 'frameCount', 'frameNumber'])
const CANVAS_BUILTIN_VAR_NAMES = new Set(['width', 'height', 'centerX', 'centerY'])
const BITMAP_MAP_TRANSPARENT_TOKEN = 'transparent'

export class Interpreter {
  private canvas: PixelCanvas
  private canvasWidth = DEFAULT_CANVAS_WIDTH
  private canvasHeight = DEFAULT_CANVAS_HEIGHT
  private errors: RuntimeError[] = []
  private mirrorX = false
  private mirrorY = false
  private hasCurrentColor = false
  private currentColor: ResolvedColor = { type: 'index', value: 0 }
  private unknownColorNames: Set<string> = new Set()
  private invalidPaletteIndexes: Set<string> = new Set()
  private invalidHexLiterals: Set<string> = new Set()
  private groups: Map<string, RuntimeGroup> = new Map()
  private bitmaps: Map<string, RuntimeBitmap> = new Map()  // bitmap name -> data
  private tilesets: Map<string, RuntimeTileset> = new Map()
  private tilemaps: Map<string, RuntimeTilemap> = new Map()
  private fonts: Map<string, RuntimeFont> = new Map()
  private colorNames: Map<string, number> = new Map()  // color name -> palette index
  private anchors: Map<string, { x: number; y: number }> = new Map()  // anchor name -> position
  private boxes: Map<string, RuntimeBox> = new Map()
  private offsetX = 0
  private offsetY = 0
  private cursorX = 0
  private cursorY = 0
  private currentLine = 0   // track current line for error reporting
  private currentColumn = 0
  private currentFilePath: string | undefined
  private paletteStartIndex = 0  // tracks next index for accumulating palette entries
  private paletteSlots: PaletteSlot[] = []
  private layers: Map<string, LayerPixels> = new Map([['base', new Map()]])
  private layerTraces: Map<string, LayerPixelTraces> = new Map([['base', new Map()]])
  private layerOrder: string[] = ['base']
  private activeLayerName = 'base'
  private stateStack: StackState[] = []
  private variableScopes: Array<Map<string, number>> = [new Map()]
  private scalarClampWarnings: Set<string> = new Set()
  private emitFadeWindowWarnings: Set<string> = new Set()
  private missingGlyphErrors: Set<string> = new Set()
  private drawOperations = 0
  private drawBudgetExceeded = false
  private drawAlphaScale = 1
  private flattenedPixelTraces: Map<string, PixelTrace> | null = null
  private currentCommandName = 'unknown'
  private currentCommandSourceSpan: SourceSpan | undefined
  private cachedProgram: Program | null = null
  private cachedPreambleSnapshot: unknown | null = null
  private cachedPreambleState: PreambleState | null = null
  private frameBuiltinsActive = false
  private pixelTraceCache: Map<string, PixelTrace> = new Map()

  constructor(canvas: PixelCanvas) {
    this.canvas = canvas
    this.syncCanvasSize()
  }

  analyzeProgram(program: Program): ProgramAnalysis {
    const preamble: ASTNode[] = []
    const declaredFrames: FrameNode[] = []

    for (const stmt of program.statements) {
      if (stmt.kind === 'frame') {
        declaredFrames.push(stmt)
      } else {
        preamble.push(stmt)
      }
    }

    // Sort frames by frame number
    declaredFrames.sort((a, b) => a.frameNumber - b.frameNumber)

    // Expand timeline by frame duration so playback/export can hold frames.
    const frames: FrameNode[] = []
    const frameNumbers: number[] = []
    for (const frame of declaredFrames) {
      const duration = Math.max(1, Math.min(MAX_FRAME_DURATION, Math.floor(frame.duration || 1)))
      for (let i = 0; i < duration; i++) {
        frames.push(frame)
        frameNumbers.push(frame.frameNumber)
      }
    }

    return {
      preamble,
      frames,
      hasAnimation: declaredFrames.length > 0,
      frameCount: frames.length,
      frameNumbers
    }
  }

  analyzeWarnings(program: Program): ProgramWarning[] {
    return analyzeProgramWarnings(program)
  }

  private syncCanvasSize(): void {
    const size = this.canvas.getSize()
    this.canvasWidth = size.width
    this.canvasHeight = size.height
  }

  private resetState(): void {
    this.errors = []
    this.mirrorX = false
    this.mirrorY = false
    this.hasCurrentColor = false
    this.currentColor = { type: 'index', value: 0 }
    this.unknownColorNames.clear()
    this.invalidPaletteIndexes.clear()
    this.invalidHexLiterals.clear()
    this.groups.clear()
    this.bitmaps.clear()
    this.tilesets.clear()
    this.tilemaps.clear()
    this.fonts.clear()
    this.colorNames.clear()
    this.anchors.clear()
    this.boxes.clear()
    this.offsetX = 0
    this.offsetY = 0
    this.cursorX = 0
    this.cursorY = 0
    this.paletteStartIndex = 0
    this.paletteSlots = []
    this.layers = new Map([['base', new Map()]])
    this.layerTraces = new Map([['base', new Map()]])
    this.layerOrder = ['base']
    this.activeLayerName = 'base'
    this.stateStack = []
    this.variableScopes = [new Map()]
    this.scalarClampWarnings.clear()
    this.emitFadeWindowWarnings.clear()
    this.missingGlyphErrors.clear()
    this.drawOperations = 0
    this.drawBudgetExceeded = false
    this.drawAlphaScale = 1
    this.flattenedPixelTraces = null
    this.currentCommandName = 'unknown'
    this.currentCommandSourceSpan = undefined
    this.currentLine = 0
    this.currentColumn = 0
    this.currentFilePath = undefined
    this.frameBuiltinsActive = false
    this.pixelTraceCache.clear()
    this.syncCanvasSize()
  }

  private addRuntimeError(
    code: RuntimeErrorCode,
    message: string,
    line = this.currentLine,
    column = this.currentColumn,
    filePath = this.currentFilePath
  ): void {
    this.errors.push({ code, message, line, column, filePath })
  }

  private clearPreambleCache(): void {
    this.cachedProgram = null
    this.cachedPreambleSnapshot = null
    this.cachedPreambleState = null
  }

  private getSnapshotCanvas(): SnapshotCanvas | null {
    const canvas = this.canvas as unknown as {
      captureSnapshot?: () => unknown
      restoreSnapshot?: (snapshot: unknown) => void
    }

    if (typeof canvas.captureSnapshot !== 'function' || typeof canvas.restoreSnapshot !== 'function') {
      return null
    }

    return {
      captureSnapshot: () => canvas.captureSnapshot!(),
      restoreSnapshot: (snapshot: unknown) => canvas.restoreSnapshot!(snapshot)
    }
  }

  private cloneCurrentColor(): ResolvedColor {
    return { type: this.currentColor.type, value: this.currentColor.value }
  }

  private cloneResolvedColor(color: ResolvedColor): ResolvedColor {
    return { type: color.type, value: color.value }
  }

  private cloneStackState(state: StackState): StackState {
    return {
      mirrorX: state.mirrorX,
      mirrorY: state.mirrorY,
      hasCurrentColor: state.hasCurrentColor,
      currentColor: this.cloneResolvedColor(state.currentColor),
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      cursorX: state.cursorX,
      cursorY: state.cursorY,
      activeLayerName: state.activeLayerName
    }
  }

  private cloneLayerPixels(layer: LayerPixels): LayerPixels {
    return new Map(Array.from(layer.entries(), ([key, color]) => [key, this.cloneResolvedColor(color)]))
  }

  private clonePixelTrace(trace: PixelTrace): PixelTrace {
    return {
      line: trace.line,
      column: trace.column,
      command: trace.command,
      layer: trace.layer,
      filePath: trace.filePath,
      sourceSpan: this.cloneSourceSpan(trace.sourceSpan)
    }
  }

  private cloneSourceSpan(span: SourceSpan | undefined): SourceSpan | undefined {
    if (!span) return undefined
    return {
      start: { ...span.start },
      end: { ...span.end }
    }
  }

  private cloneLayerPixelTraces(layer: LayerPixelTraces): LayerPixelTraces {
    return new Map(Array.from(layer.entries(), ([key, trace]) => [key, this.clonePixelTrace(trace)]))
  }

  private cloneLayers(layers: Map<string, LayerPixels>): Map<string, LayerPixels> {
    return new Map(Array.from(layers.entries(), ([name, layer]) => [name, this.cloneLayerPixels(layer)]))
  }

  private cloneLayerTraces(layerTraces: Map<string, LayerPixelTraces>): Map<string, LayerPixelTraces> {
    return new Map(Array.from(layerTraces.entries(), ([name, layer]) => [name, this.cloneLayerPixelTraces(layer)]))
  }

  private cloneTilesets(tilesets: Map<string, RuntimeTileset>): Map<string, RuntimeTileset> {
    return new Map(
      Array.from(tilesets.entries(), ([name, tileset]) => [
        name,
        {
          tileWidth: tileset.tileWidth,
          tileHeight: tileset.tileHeight,
          seed: tileset.seed,
          symbols: new Map(
            Array.from(tileset.symbols.entries(), ([symbol, variants]) => [
              symbol,
              variants.map((variant) => ({ target: variant.target, weight: variant.weight }))
            ])
          )
        }
      ])
    )
  }

  private cloneTilemaps(tilemaps: Map<string, RuntimeTilemap>): Map<string, RuntimeTilemap> {
    return new Map(
      Array.from(tilemaps.entries(), ([name, tilemap]) => [
        name,
        {
          tilesetName: tilemap.tilesetName,
          rows: [...tilemap.rows]
        }
      ])
    )
  }

  private cloneVariableScopes(scopes: Array<Map<string, number>>): Array<Map<string, number>> {
    return scopes.map((scope) => new Map(scope))
  }

  private ensureVariableScope(): Map<string, number> {
    if (this.variableScopes.length === 0) {
      this.variableScopes.push(new Map())
    }
    return this.variableScopes[this.variableScopes.length - 1]
  }

  private pushVariableScope(initial?: Record<string, number>): void {
    const scope = new Map<string, number>()
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        scope.set(key, value)
      }
    }
    this.variableScopes.push(scope)
  }

  private popVariableScope(): void {
    if (this.variableScopes.length > 1) {
      this.variableScopes.pop()
    }
  }

  private setVariable(name: string, value: number): void {
    this.ensureVariableScope().set(name, value)
  }

  private getVariable(name: string): number | null {
    for (let i = this.variableScopes.length - 1; i >= 0; i--) {
      const value = this.variableScopes[i].get(name)
      if (value !== undefined) {
        return value
      }
    }
    if (!CANVAS_BUILTIN_VAR_NAMES.has(name)) {
      return null
    }

    const width = this.canvasWidth
    const height = this.canvasHeight
    switch (name) {
      case 'width':
        return width
      case 'height':
        return height
      case 'centerX':
        return Math.floor(width / 2)
      case 'centerY':
        return Math.floor(height / 2)
      default:
        return null
    }
  }

  private ensureLayer(name: string): LayerPixels {
    let layer = this.layers.get(name)
    if (!layer) {
      layer = new Map()
      this.layers.set(name, layer)
      this.layerOrder.push(name)
    }
    if (!this.layerTraces.has(name)) {
      this.layerTraces.set(name, new Map())
    }
    return layer
  }

  private executeLayer(name: string): void {
    this.ensureLayer(name)
    this.activeLayerName = name
  }

  private captureCurrentStackState(): StackState {
    return {
      mirrorX: this.mirrorX,
      mirrorY: this.mirrorY,
      hasCurrentColor: this.hasCurrentColor,
      currentColor: this.cloneCurrentColor(),
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
      activeLayerName: this.activeLayerName
    }
  }

  private executePush(): void {
    this.stateStack.push(this.captureCurrentStackState())
  }

  private executePop(): void {
    const state = this.stateStack.pop()
    if (!state) {
      this.addRuntimeError('R002', 'State stack underflow: pop called with empty stack')
      return
    }

    this.mirrorX = state.mirrorX
    this.mirrorY = state.mirrorY
    this.hasCurrentColor = state.hasCurrentColor
    this.currentColor = this.cloneResolvedColor(state.currentColor)
    this.offsetX = state.offsetX
    this.offsetY = state.offsetY
    this.cursorX = state.cursorX
    this.cursorY = state.cursorY
    this.activeLayerName = state.activeLayerName
    this.ensureLayer(this.activeLayerName)
  }

  private getActiveLayer(): LayerPixels {
    return this.ensureLayer(this.activeLayerName)
  }

  private getLayerTraces(name: string): LayerPixelTraces {
    this.ensureLayer(name)
    let traces = this.layerTraces.get(name)
    if (!traces) {
      traces = new Map()
      this.layerTraces.set(name, traces)
    }
    return traces
  }

  private getActiveLayerTraces(): LayerPixelTraces {
    return this.getLayerTraces(this.activeLayerName)
  }

  private makeLayerPixelKey(x: number, y: number): string {
    return `${x},${y}`
  }

  private parseLayerPixelKey(key: string): { x: number; y: number } {
    const commaIndex = key.indexOf(',')
    if (commaIndex < 0) {
      return { x: 0, y: 0 }
    }

    const x = Number(key.slice(0, commaIndex))
    const y = Number(key.slice(commaIndex + 1))
    return { x, y }
  }

  private invalidateFlattenedPixelTraces(): void {
    this.flattenedPixelTraces = null
  }

  private getCurrentPixelTrace(): PixelTrace {
    return this.getPixelTraceForLayer(this.activeLayerName)
  }

  private getPixelTraceForLayer(layerName: string): PixelTrace {
    const cached = this.pixelTraceCache.get(layerName)
    if (cached) {
      return cached
    }

    const trace: PixelTrace = {
      line: this.currentLine,
      column: this.currentColumn,
      command: this.currentCommandName,
      layer: layerName,
      filePath: this.currentFilePath,
      sourceSpan: this.cloneSourceSpan(this.currentCommandSourceSpan)
    }
    this.pixelTraceCache.set(layerName, trace)
    return trace
  }

  private buildCurrentCommandSourceSpan(): SourceSpan | undefined {
    if (this.currentLine < 1 || this.currentColumn < 1) return undefined
    const tokenLength = Math.max(1, this.currentCommandName.length)
    return {
      start: {
        line: this.currentLine,
        column: this.currentColumn,
        filePath: this.currentFilePath
      },
      end: {
        line: this.currentLine,
        column: this.currentColumn + tokenLength,
        filePath: this.currentFilePath
      }
    }
  }

  private commandNameForNodeKind(kind: ASTNode['kind']): string {
    switch (kind) {
      case 'pixel':
        return 'px'
      case 'circle':
        return 'circ'
      case 'arc':
        return 'arc'
      case 'polygon':
        return 'poly'
      case 'orect':
        return 'orect'
      case 'ocirc':
        return 'ocirc'
      case 'opoly':
        return 'opoly'
      default:
        return kind
    }
  }

  private isHexTransparent(hex: string): boolean {
    return isTransparentHexColorLiteral(hex)
  }

  private isResolvedColorTransparent(color: ResolvedColor): boolean {
    if (color.type === 'hex') {
      return this.isHexTransparent(String(color.value))
    }

    const index = color.value as number
    const paletteColor = this.canvas.getPalette()[index]
    if (!paletteColor) return false
    return this.isHexTransparent(paletteColor)
  }

  private resolvedColorToRgba(color: ResolvedColor): [number, number, number, number] {
    if (color.type === 'hex') {
      return this.parseHexToRgba(String(color.value))
    }
    const palette = this.canvas.getPalette()
    const hex = palette[color.value as number] || '#000000'
    return this.parseHexToRgba(hex)
  }

  private rgbaToResolvedColor(r: number, g: number, b: number, a: number): ResolvedColor {
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a.toString(16).padStart(2, '0')}`
    return { type: 'hex', value: hex }
  }

  private setActiveLayerPixel(x: number, y: number, color: ResolvedColor): void {
    const width = this.canvasWidth
    const height = this.canvasHeight
    if (x < 0 || x >= width || y < 0 || y >= height) return

    const layer = this.layers.get(this.activeLayerName) ?? this.ensureLayer(this.activeLayerName)
    const layerTraces = this.layerTraces.get(this.activeLayerName) ?? this.getLayerTraces(this.activeLayerName)
    const key = this.makeLayerPixelKey(x, y)
    const trace = this.getCurrentPixelTrace()

    if (this.isResolvedColorTransparent(color)) {
      layer.delete(key)
      layerTraces.delete(key)
      this.invalidateFlattenedPixelTraces()
      return
    }

    const [sr, sg, sb, sa] = this.resolvedColorToRgba(color)

    // Fully opaque: overwrite as before
    if (sa === 255) {
      layer.set(key, color)
      layerTraces.set(key, trace)
      this.invalidateFlattenedPixelTraces()
      return
    }

    // Semi-transparent: alpha-blend over existing pixel
    const existing = layer.get(key)
    if (!existing) {
      // Nothing beneath — store as-is (will blend during layer compositing)
      layer.set(key, color)
      layerTraces.set(key, trace)
      this.invalidateFlattenedPixelTraces()
      return
    }

    const [dr, dg, db, da] = this.resolvedColorToRgba(existing)

    // Standard source-over alpha compositing
    const srcA = sa / 255
    const dstA = da / 255
    const outA = srcA + dstA * (1 - srcA)

    if (outA === 0) {
      layer.delete(key)
      layerTraces.delete(key)
      this.invalidateFlattenedPixelTraces()
      return
    }

    const outR = Math.round((sr * srcA + dr * dstA * (1 - srcA)) / outA)
    const outG = Math.round((sg * srcA + dg * dstA * (1 - srcA)) / outA)
    const outB = Math.round((sb * srcA + db * dstA * (1 - srcA)) / outA)
    const outAi = Math.round(outA * 255)

    layer.set(key, this.rgbaToResolvedColor(outR, outG, outB, outAi))
    layerTraces.set(key, trace)
    this.invalidateFlattenedPixelTraces()
  }

  private getActiveLayerPixel(x: number, y: number): ResolvedColor | null {
    const width = this.canvasWidth
    const height = this.canvasHeight
    if (x < 0 || x >= width || y < 0 || y >= height) return null
    const layer = this.layers.get(this.activeLayerName) ?? this.ensureLayer(this.activeLayerName)
    return layer.get(this.makeLayerPixelKey(x, y)) ?? null
  }

  private resolvedColorEquals(a: ResolvedColor | null, b: ResolvedColor | null): boolean {
    if (a === null && b === null) return true
    if (a === null || b === null) return false
    return a.type === b.type && a.value === b.value
  }

  private fillActiveLayer(startX: number, startY: number, color: ResolvedColor): void {
    const { width, height } = this.canvas.getSize()
    if (startX < 0 || startX >= width || startY < 0 || startY >= height) return

    const replacement = this.isResolvedColorTransparent(color)
      ? null
      : this.cloneResolvedColor(color)

    const target = this.getActiveLayerPixel(startX, startY)
    if (this.resolvedColorEquals(target, replacement)) return

    const visited = new Uint8Array(width * height)
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }]
    let head = 0
    const layer = this.getActiveLayer()
    const layerTraces = this.getActiveLayerTraces()
    const trace = this.getCurrentPixelTrace()
    let mutated = false

    while (head < queue.length) {
      const { x, y } = queue[head++]
      if (x < 0 || x >= width || y < 0 || y >= height) continue

      const visitIndex = y * width + x
      if (visited[visitIndex]) continue
      visited[visitIndex] = 1

      const key = this.makeLayerPixelKey(x, y)
      const current = layer.get(key) ?? null
      if (!this.resolvedColorEquals(current, target)) continue

      if (this.consumeDrawBudgetUnits(1) === 0) break

      if (replacement === null) {
        layer.delete(key)
        layerTraces.delete(key)
      } else {
        layer.set(key, this.cloneResolvedColor(replacement))
        layerTraces.set(key, trace)
      }
      mutated = true

      queue.push({ x: x + 1, y })
      queue.push({ x: x - 1, y })
      queue.push({ x, y: y + 1 })
      queue.push({ x, y: y - 1 })
    }

    if (mutated) {
      this.invalidateFlattenedPixelTraces()
    }
  }

  private compositeLayersToCanvas(): void {
    this.canvas.clear()
    for (const layerName of this.layerOrder) {
      const layer = this.layers.get(layerName)
      if (!layer) continue
      for (const [key, color] of layer.entries()) {
        const commaIndex = key.indexOf(',')
        if (commaIndex < 0) continue
        const x = Number(key.slice(0, commaIndex))
        const y = Number(key.slice(commaIndex + 1))
        this.canvas.pixel(x, y, color)
      }
    }
  }

  private buildFlattenedPixelTraces(): Map<string, PixelTrace> {
    const flattened = new Map<string, PixelTrace>()

    for (const layerName of this.layerOrder) {
      const layerPixels = this.layers.get(layerName)
      if (!layerPixels) continue
      const layerTraces = this.layerTraces.get(layerName)
      for (const key of layerPixels.keys()) {
        const trace = layerTraces?.get(key)
        if (trace) {
          flattened.set(key, this.clonePixelTrace(trace))
        } else {
          flattened.set(key, {
            line: 0,
            column: 0,
            command: 'unknown',
            layer: layerName
          })
        }
      }
    }

    return flattened
  }

  private capturePreambleState(): PreambleState {
    return {
      mirrorX: this.mirrorX,
      mirrorY: this.mirrorY,
      hasCurrentColor: this.hasCurrentColor,
      currentColor: this.cloneCurrentColor(),
      unknownColorNames: new Set(this.unknownColorNames),
      invalidPaletteIndexes: new Set(this.invalidPaletteIndexes),
      bitmaps: new Map(Array.from(this.bitmaps.entries(), ([name, data]) => [
        name,
        {
          rows: [...data.rows],
          colorMap: data.colorMap ? { ...data.colorMap } : undefined,
          pivot: data.pivot ? { x: data.pivot.x, y: data.pivot.y } : undefined
        }
      ])),
      tilesets: this.cloneTilesets(this.tilesets),
      tilemaps: this.cloneTilemaps(this.tilemaps),
      anchors: new Map(this.anchors),
      boxes: new Map(Array.from(this.boxes.entries(), ([name, box]) => [name, { ...box }])),
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
      layers: this.cloneLayers(this.layers),
      layerTraces: this.cloneLayerTraces(this.layerTraces),
      layerOrder: [...this.layerOrder],
      activeLayerName: this.activeLayerName,
      stateStack: this.stateStack.map((state) => this.cloneStackState(state)),
      variableScopes: this.cloneVariableScopes(this.variableScopes)
    }
  }

  private restorePreambleState(state: PreambleState): void {
    this.mirrorX = state.mirrorX
    this.mirrorY = state.mirrorY
    this.hasCurrentColor = state.hasCurrentColor
    this.currentColor = { type: state.currentColor.type, value: state.currentColor.value }
    this.unknownColorNames = new Set(state.unknownColorNames)
    this.invalidPaletteIndexes = new Set(state.invalidPaletteIndexes)
    this.bitmaps = new Map(Array.from(state.bitmaps.entries(), ([name, data]) => [
      name,
      {
        rows: [...data.rows],
        colorMap: data.colorMap ? { ...data.colorMap } : undefined,
        pivot: data.pivot ? { x: data.pivot.x, y: data.pivot.y } : undefined
      }
    ]))
    this.tilesets = this.cloneTilesets(state.tilesets)
    this.tilemaps = this.cloneTilemaps(state.tilemaps)
    this.anchors = new Map(state.anchors)
    this.boxes = new Map(Array.from(state.boxes.entries(), ([name, box]) => [name, { ...box }]))
    this.offsetX = state.offsetX
    this.offsetY = state.offsetY
    this.cursorX = state.cursorX
    this.cursorY = state.cursorY
    this.layers = this.cloneLayers(state.layers)
    this.layerTraces = this.cloneLayerTraces(state.layerTraces)
    this.layerOrder = [...state.layerOrder]
    this.activeLayerName = state.activeLayerName
    this.ensureLayer(this.activeLayerName)
    this.getActiveLayerTraces()
    this.invalidateFlattenedPixelTraces()
    this.stateStack = state.stateStack.map((stackState) => this.cloneStackState(stackState))
    this.variableScopes = this.cloneVariableScopes(state.variableScopes)
    this.ensureVariableScope()
  }

  /**
   * Observer notified after each top-level statement finishes. This is what makes
   * replay possible: a PixelCraft program is a recipe, and an observer can render
   * the canvas between ingredients. Survives resetState so it can be installed once
   * before execute().
   */
  private stepObserver: ((node: ASTNode) => void) | null = null

  /** Install (or clear, with null) the per-statement observer. */
  setStepObserver(observer: ((node: ASTNode) => void) | null): void {
    this.stepObserver = observer
  }

  private executePreambleNodes(nodes: ASTNode[]): void {
    for (const stmt of nodes) {
      if (this.drawBudgetExceeded) break
      try {
        this.executeNode(stmt)
      } catch (e) {
        this.addRuntimeError('R026', String(e), stmt.pos.line, stmt.pos.column, stmt.pos.filePath)
      }
      if (this.stepObserver) {
        // Drawing accumulates in layers; the canvas is only ever written by
        // compositing. Flatten so the observer sees the picture as it stands,
        // then hand it the statement that produced it.
        this.compositeLayersToCanvas()
        this.stepObserver(stmt)
      }
    }
  }

  private executeFrameNodes(nodes: ASTNode[]): void {
    for (const stmt of nodes) {
      if (this.drawBudgetExceeded) break
      try {
        this.executeNode(stmt)
      } catch (e) {
        this.addRuntimeError('R026', String(e), stmt.pos.line, stmt.pos.column, stmt.pos.filePath)
      }
      if (this.stepObserver) {
        // Drawing accumulates in layers; the canvas is only ever written by
        // compositing. Flatten so the observer sees the picture as it stands,
        // then hand it the statement that produced it.
        this.compositeLayersToCanvas()
        this.stepObserver(stmt)
      }
    }
  }

  private reportInvalidHexLiteralOnce(hex: string, context: string): void {
    const key = `${context}:${hex}`
    if (this.invalidHexLiterals.has(key)) return
    this.invalidHexLiterals.add(key)
    this.addRuntimeError(
      'R015',
      `Invalid hex color "${hex}" in ${context}. Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`
    )
  }

  execute(program: Program, frameIndex?: number): RuntimeError[] {
    this.resetState()
    this.canvas.clear()
    this.canvas.setPalette(['#000000'])

    const analysis = this.analyzeProgram(program)
    if (this.cachedProgram !== program) {
      this.clearPreambleCache()
    }

    // First pass: find canvas size, palette, and groups from preamble
    let hasCanvas = false

    for (const stmt of analysis.preamble) {
      this.currentLine = stmt.pos.line
      this.currentColumn = stmt.pos.column
      this.currentFilePath = stmt.pos.filePath
      this.currentCommandName = this.commandNameForNodeKind(stmt.kind)
      this.currentCommandSourceSpan = this.buildCurrentCommandSourceSpan()

      if (stmt.kind === 'canvas') {
        if (!isCanvasDimensionValid(stmt.width) || !isCanvasDimensionValid(stmt.height)) {
          this.addRuntimeError(
            'R016',
            `Canvas size must be ${MIN_CANVAS_DIMENSION}..${MAX_CANVAS_DIMENSION} per side (got ${stmt.width}x${stmt.height})`,
            stmt.pos.line,
            stmt.pos.column
          )
          continue
        }

        this.canvas.resize(stmt.width, stmt.height)
        this.canvas.clear()
        this.syncCanvasSize()
        hasCanvas = true
      } else if (stmt.kind === 'palette') {
        // Expand palette entries, handling gradients
        const expandedHexColors: string[] = []
        const expandedNames: { name: string; offset: number }[] = []
        const expandedSlots: PaletteSlot[] = []

        for (const entry of stmt.colors) {
          if (entry.hexEnd && entry.steps) {
            // Gradient entry: interpolate between hex and hexEnd
            const safeStart = isValidHexColorLiteral(entry.hex) ? entry.hex : '#000000'
            const safeEnd = isValidHexColorLiteral(entry.hexEnd) ? entry.hexEnd : '#000000'
            if (safeStart !== entry.hex) {
              this.addRuntimeError(
                'R015',
                `Invalid hex color "${entry.hex}" in palette gradient start.`,
                stmt.pos.line,
                stmt.pos.column
              )
            }
            if (safeEnd !== entry.hexEnd) {
              this.addRuntimeError(
                'R015',
                `Invalid hex color "${entry.hexEnd}" in palette gradient end.`,
                stmt.pos.line,
                stmt.pos.column
              )
            }

            const clampedSteps = Math.max(2, Math.min(MAX_GRADIENT_STEPS, Math.floor(entry.steps)))
            if (clampedSteps !== entry.steps) {
              this.addRuntimeError(
                'R018',
                `Clamped gradient steps from ${entry.steps} to ${clampedSteps} (max ${MAX_GRADIENT_STEPS}).`,
                stmt.pos.line,
                stmt.pos.column
              )
            }
            const gradientColors = this.interpolateColors(safeStart, safeEnd, clampedSteps)
            for (let i = 0; i < gradientColors.length; i++) {
              const offset = expandedHexColors.length
              if (entry.name) {
                expandedNames.push({ name: `${entry.name}${i}`, offset })
              }
              expandedHexColors.push(gradientColors[i])
              expandedSlots.push({
                index: this.paletteStartIndex + offset,
                hex: gradientColors[i],
                name: entry.name ? `${entry.name}${i}` : undefined,
                presetName: entry.presetName,
                presetColorIndex: entry.presetColorIndex,
                sourceSpan: entry.sourceSpan,
                hexSpan: entry.hexSpan,
                hexEndSpan: entry.hexEndSpan,
                stepsSpan: entry.stepsSpan,
                isGradientDerived: true,
                gradientStepIndex: i,
                gradientSteps: clampedSteps
              })
            }
          } else {
            // Simple color entry
            const safeHex = isValidHexColorLiteral(entry.hex) ? entry.hex : '#000000'
            if (safeHex !== entry.hex) {
              this.addRuntimeError(
                'R015',
                `Invalid hex color "${entry.hex}" in palette entry.`,
                stmt.pos.line,
                stmt.pos.column
              )
            }
            const offset = expandedHexColors.length
            if (entry.name) {
              expandedNames.push({ name: entry.name, offset })
            }
            expandedHexColors.push(safeHex)
            expandedSlots.push({
              index: this.paletteStartIndex + offset,
              hex: safeHex,
              name: entry.name,
              presetName: entry.presetName,
              presetColorIndex: entry.presetColorIndex,
              sourceSpan: entry.sourceSpan,
              hexSpan: entry.hexSpan,
              hexEndSpan: entry.hexEndSpan,
              stepsSpan: entry.stepsSpan,
              isGradientDerived: false
            })
          }
        }

        if (this.paletteStartIndex === 0) {
          this.canvas.setPalette(expandedHexColors)
        } else {
          this.canvas.setPalette([...this.canvas.getPalette(), ...expandedHexColors])
        }

        // Build color name mapping
        for (const { name, offset } of expandedNames) {
          this.colorNames.set(name, this.paletteStartIndex + offset)
        }

        this.paletteSlots.push(...expandedSlots)
        this.paletteStartIndex += expandedHexColors.length
      } else if (stmt.kind === 'group') {
        this.groups.set(stmt.name, {
          body: stmt.body,
          pivot: stmt.pivot ? { x: stmt.pivot.x, y: stmt.pivot.y } : undefined
        })
      } else if (stmt.kind === 'font') {
        this.fonts.set(stmt.name, this.compileFont(stmt))
      }
    }

    // Keep preview functional, but report missing required setup.
    if (!hasCanvas) {
      this.addRuntimeError(
        'R001',
        `Missing canvas command. Add "canvas ${DEFAULT_CANVAS_WIDTH}x${DEFAULT_CANVAS_HEIGHT}" near the top of your program.`,
        1,
        1
      )
      this.canvas.resize(DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT)
      this.canvas.clear()
      this.syncCanvasSize()
    }

    // If no animation, execute preamble as before (backwards compatible)
    if (!analysis.hasAnimation) {
      this.executePreambleNodes(analysis.preamble)
      this.compositeLayersToCanvas()
      return this.errors
    }

    // Animation mode: execute preamble once and restore from a cached snapshot on later frames.
    this.mirrorX = false
    this.mirrorY = false
    this.offsetX = 0
    this.offsetY = 0
    this.cursorX = 0
    this.cursorY = 0

    const preambleNodes = analysis.preamble.filter((stmt) =>
      stmt.kind !== 'canvas' && stmt.kind !== 'palette' && stmt.kind !== 'group' && stmt.kind !== 'font'
    )

    const snapshotCanvas = this.getSnapshotCanvas()
    const cachedSnapshot = this.cachedPreambleSnapshot
    const cachedState = this.cachedPreambleState
    const canRestorePreamble =
      this.cachedProgram === program &&
      cachedState !== null

    if (canRestorePreamble) {
      this.restorePreambleState(cachedState)
      if (cachedSnapshot !== null && snapshotCanvas !== null) {
        snapshotCanvas.restoreSnapshot(cachedSnapshot)
      }
    } else {
      this.executePreambleNodes(preambleNodes)
      this.compositeLayersToCanvas()

      if (this.errors.length === 0) {
        this.cachedProgram = program
        this.cachedPreambleSnapshot = snapshotCanvas ? snapshotCanvas.captureSnapshot() : null
        this.cachedPreambleState = this.capturePreambleState()
      } else {
        this.clearPreambleCache()
      }
    }

    // Execute the requested frame (or first frame by default)
    const targetIndex = frameIndex !== undefined ? frameIndex : 0
    if (targetIndex >= 0 && targetIndex < analysis.frames.length) {
      const frame = analysis.frames[targetIndex]
      this.frameBuiltinsActive = true
      this.pushVariableScope({
        frame: targetIndex,
        frameCount: analysis.frameCount,
        frameNumber: frame.frameNumber
      })
      try {
        this.executeFrameNodes(frame.body)
      } finally {
        this.popVariableScope()
        this.frameBuiltinsActive = false
      }
    }

    this.compositeLayersToCanvas()

    return this.errors
  }

  private evaluateExpr(expr: Expr): number {
    switch (expr.kind) {
      case 'literal':
        return expr.value
      case 'var': {
        const value = this.getVariable(expr.name)
        if (value === null) {
          this.addRuntimeError('R003', `Unknown variable: $${expr.name}`)
          return 0
        }
        return value
      }
      case 'pairVar': {
        this.addRuntimeError('R003', `Pair symbol "${expr.name}" cannot be used as a scalar expression`)
        return 0
      }
      case 'unary': {
        const value = this.evaluateExpr(expr.expr)
        return expr.op === '-' ? -value : value
      }
      case 'binary': {
        const left = this.evaluateExpr(expr.left)
        const right = this.evaluateExpr(expr.right)
        switch (expr.op) {
          case '+': return left + right
          case '-': return left - right
          case '*': return left * right
          case '/':
            if (right === 0) {
              this.addRuntimeError('R004', 'Division by zero in expression')
              return 0
            }
            return left / right
          case '%':
            if (right === 0) {
              this.addRuntimeError('R005', 'Modulo by zero in expression')
              return 0
            }
            return left % right
        }
      }
      case 'call': {
        const args = expr.args.map((arg) => this.evaluateExpr(arg))
        return evaluateExpressionIntrinsic(expr.name, args)
      }
    }
  }

  private warnScalarClamped(context: string, raw: number, clamped: number, min: number, max: number): void {
    const direction = raw < min ? 'low' : 'high'
    const key = `${context}:${direction}`
    if (this.scalarClampWarnings.has(key)) return
    this.scalarClampWarnings.add(key)
    this.addRuntimeError('R017', `Clamped ${context} from ${raw} to ${clamped} (allowed ${min}..${max}).`)
  }

  private clampScalarRange(value: number, min: number, max: number, context: string): number {
    if (value < min) {
      this.warnScalarClamped(context, value, min, min, max)
      return min
    }
    if (value > max) {
      this.warnScalarClamped(context, value, max, min, max)
      return max
    }
    return value
  }

  private isExtentContext(context: string): boolean {
    return (
      context.endsWith(' width') ||
      context.endsWith(' height') ||
      context.endsWith(' radius') ||
      context.endsWith(' rx') ||
      context.endsWith(' ry') ||
      context.endsWith(' stepX') ||
      context.endsWith(' stepY')
    )
  }

  private isCoordinateContext(context: string): boolean {
    return (
      context === 'x' ||
      context === 'y' ||
      context === 'anchor x' ||
      context === 'anchor y' ||
      context === 'repeat dx' ||
      context === 'repeat dy'
    )
  }

  private consumeDrawBudget(): void {
    if (this.drawBudgetExceeded) return
    this.drawOperations++
    if (this.drawOperations <= MAX_DRAW_OPERATIONS) return

    this.drawBudgetExceeded = true
    this.addRuntimeError(
      'R012',
      `Render aborted: draw budget exceeded (${MAX_DRAW_OPERATIONS} operations). Reduce shape sizes or repeat/tile/scatter/emit counts.`
    )
  }

  private consumeDrawBudgetUnits(units: number): number {
    const requested = Math.max(0, Math.floor(units))
    if (requested <= 0 || this.drawBudgetExceeded) return 0

    let consumed = 0
    while (consumed < requested && !this.drawBudgetExceeded) {
      this.consumeDrawBudget()
      if (this.drawBudgetExceeded) break
      consumed++
    }

    return consumed
  }

  private resolveBulkDrawColor(color: Color): ResolvedColor | null {
    const resolvedColor = this.resolveColor(color)
    if (this.drawAlphaScale < 1) {
      return this.applyDrawAlphaScale(resolvedColor)
    }
    return resolvedColor
  }

  private clearLayerWithBudget(layer: LayerPixels, layerTraces: LayerPixelTraces): boolean {
    if (layer.size === 0 && layerTraces.size === 0) return false

    const keys = Array.from(layer.keys())
    let mutated = false
    for (const key of keys) {
      if (this.consumeDrawBudgetUnits(1) === 0) break
      layer.delete(key)
      layerTraces.delete(key)
      mutated = true
    }

    if (!this.drawBudgetExceeded) {
      if (layer.size > 0 || layerTraces.size > 0) {
        mutated = true
      }
      layer.clear()
      layerTraces.clear()
    }

    return mutated
  }

  private evaluateScalar(value: ScalarValue, context: string): number {
    const raw = typeof value === 'number' ? value : this.evaluateExpr(value)
    if (!Number.isFinite(raw)) {
      this.addRuntimeError('R006', 'Expression evaluated to a non-finite number')
      return 0
    }

    const truncated = Math.trunc(raw)
    if (context === 'repeat count') {
      return this.clampScalarRange(truncated, -MAX_REPEAT_COUNT, MAX_REPEAT_COUNT, context)
    }
    if (context === 'scatter count') {
      return this.clampScalarRange(truncated, -MAX_SCATTER_COUNT, MAX_SCATTER_COUNT, context)
    }
    if (context === 'emit count') {
      return this.clampScalarRange(truncated, -MAX_EMIT_COUNT, MAX_EMIT_COUNT, context)
    }
    if (this.isExtentContext(context)) {
      return this.clampScalarRange(truncated, -MAX_EXTENT, MAX_EXTENT, context)
    }
    if (this.isCoordinateContext(context)) {
      return this.clampScalarRange(truncated, -MAX_ABS_COORD, MAX_ABS_COORD, context)
    }

    return truncated
  }

  private evaluatePairValues(
    width: ScalarValue,
    height: ScalarValue,
    widthContext: string,
    heightContext: string
  ): { width: number; height: number } {
    return {
      width: this.evaluateScalar(width, widthContext),
      height: this.evaluateScalar(height, heightContext)
    }
  }

  private evaluateUnitScalar(value: ScalarValue, context: string): number {
    const raw = typeof value === 'number' ? value : this.evaluateExpr(value)
    if (!Number.isFinite(raw)) {
      this.addRuntimeError('R006', 'Expression evaluated to a non-finite number')
      return 0
    }

    return this.clampScalarRange(raw, 0, 1, context)
  }

  private resolveAnchor(anchorName: string): { x: number; y: number } | null {
    const anchor = this.anchors.get(anchorName)
    if (!anchor) {
      this.addRuntimeError('R007', `Unknown anchor: ${anchorName} (define it with "anchor ${anchorName} x,y")`)
      return null
    }
    return anchor
  }

  private resolveBox(boxName: string): RuntimeBox | null {
    const box = this.boxes.get(boxName)
    if (!box) {
      this.addRuntimeError('R033', `Unknown box: ${boxName} (define it with "box ${boxName} x,y WxH")`)
      return null
    }
    return box
  }

  private resolveBoxPoint(boxName: string, selector: BoxPointSelector | undefined): { x: number; y: number } | null {
    const box = this.resolveBox(boxName)
    if (!box) return null

    const centerX = box.x + Math.floor(box.width / 2)
    const centerY = box.y + Math.floor(box.height / 2)
    const rightX = box.x + box.width - 1
    const bottomY = box.y + box.height - 1

    switch (selector ?? 'center') {
      case 'center':
        return { x: centerX, y: centerY }
      case 'top':
        return { x: centerX, y: box.y }
      case 'bottom':
        return { x: centerX, y: bottomY }
      case 'left':
        return { x: box.x, y: centerY }
      case 'right':
        return { x: rightX, y: centerY }
      case 'topLeft':
        return { x: box.x, y: box.y }
      case 'topRight':
        return { x: rightX, y: box.y }
      case 'bottomLeft':
        return { x: box.x, y: bottomY }
      case 'bottomRight':
        return { x: rightX, y: bottomY }
    }
  }

  private getBoxSelectorOffset(selector: BoxPointSelector | undefined, width: number, height: number): { x: number; y: number } {
    const resolvedSelector = selector ?? 'center'
    const centerX = Math.floor(width / 2)
    const centerY = Math.floor(height / 2)
    const rightX = width - 1
    const bottomY = height - 1

    switch (resolvedSelector) {
      case 'center':
        return { x: centerX, y: centerY }
      case 'top':
        return { x: centerX, y: 0 }
      case 'bottom':
        return { x: centerX, y: bottomY }
      case 'left':
        return { x: 0, y: centerY }
      case 'right':
        return { x: rightX, y: centerY }
      case 'topLeft':
        return { x: 0, y: 0 }
      case 'topRight':
        return { x: rightX, y: 0 }
      case 'bottomLeft':
        return { x: 0, y: bottomY }
      case 'bottomRight':
        return { x: rightX, y: bottomY }
    }
  }

  private resolveX(
    x: ScalarValue,
    isCenter: boolean,
    anchorName?: string,
    isRelative = false,
    boxName?: string,
    boxPoint?: BoxPointSelector
  ): number {
    const resolvedX = this.evaluateScalar(x, 'x')
    if (anchorName) {
      const anchor = this.resolveAnchor(anchorName)
      if (anchor) {
        return anchor.x + resolvedX + this.offsetX
      }
      return this.offsetX  // fallback if anchor not found
    }
    if (boxName) {
      const point = this.resolveBoxPoint(boxName, boxPoint)
      if (point) {
        return point.x + resolvedX + this.offsetX
      }
      return this.offsetX
    }
    if (isCenter) {
      return this.canvas.getCenter().x + this.offsetX
    }
    if (isRelative) {
      return this.cursorX + resolvedX
    }
    return resolvedX + this.offsetX
  }

  private resolveY(
    y: ScalarValue,
    isCenter: boolean,
    anchorName?: string,
    isRelative = false,
    boxName?: string,
    boxPoint?: BoxPointSelector
  ): number {
    const resolvedY = this.evaluateScalar(y, 'y')
    if (anchorName) {
      const anchor = this.resolveAnchor(anchorName)
      if (anchor) {
        return anchor.y + resolvedY + this.offsetY
      }
      return this.offsetY  // fallback if anchor not found
    }
    if (boxName) {
      const point = this.resolveBoxPoint(boxName, boxPoint)
      if (point) {
        return point.y + resolvedY + this.offsetY
      }
      return this.offsetY
    }
    if (isCenter) {
      return this.canvas.getCenter().y + this.offsetY
    }
    if (isRelative) {
      return this.cursorY + resolvedY
    }
    return resolvedY + this.offsetY
  }

  private resolvePoint(pt: Point): { x: number; y: number } {
    let x: number
    let y: number

    if (pt.anchorName || pt.boxName) {
      // Anchor-based positioning
      const base = pt.anchorName
        ? this.resolveAnchor(pt.anchorName)
        : this.resolveBoxPoint(pt.boxName!, pt.boxPoint)
      if (base) {
        x = base.x + this.evaluateScalar(pt.x, 'x') + this.offsetX
        y = base.y + this.evaluateScalar(pt.y, 'y') + this.offsetY
      } else {
        x = this.offsetX
        y = this.offsetY
      }
    } else if (pt.isCenter) {
      x = this.canvas.getCenter().x + this.offsetX
      y = this.canvas.getCenter().y + this.offsetY
    } else {
      // Handle relative positioning
      const resolvedX = this.evaluateScalar(pt.x, 'x')
      const resolvedY = this.evaluateScalar(pt.y, 'y')
      x = pt.isRelativeX ? this.cursorX + resolvedX : resolvedX + this.offsetX
      y = pt.isRelativeY ? this.cursorY + resolvedY : resolvedY + this.offsetY
    }

    // Update cursor to the resolved position
    this.cursorX = x
    this.cursorY = y

    return { x, y }
  }

  private resolvePointWithoutCursorUpdate(pt: Point): { x: number; y: number } {
    if (pt.anchorName || pt.boxName) {
      const base = pt.anchorName
        ? this.resolveAnchor(pt.anchorName)
        : this.resolveBoxPoint(pt.boxName!, pt.boxPoint)
      if (!base) {
        return { x: this.offsetX, y: this.offsetY }
      }
      return {
        x: base.x + this.evaluateScalar(pt.x, 'x') + this.offsetX,
        y: base.y + this.evaluateScalar(pt.y, 'y') + this.offsetY
      }
    }

    if (pt.isCenter) {
      return {
        x: this.canvas.getCenter().x + this.offsetX,
        y: this.canvas.getCenter().y + this.offsetY
      }
    }

    const resolvedX = this.evaluateScalar(pt.x, 'x')
    const resolvedY = this.evaluateScalar(pt.y, 'y')
    return {
      x: pt.isRelativeX ? this.cursorX + resolvedX : resolvedX + this.offsetX,
      y: pt.isRelativeY ? this.cursorY + resolvedY : resolvedY + this.offsetY
    }
  }

  // For extent-based commands, "center" is the shape pivot, not the top-left.
  private resolveTopLeft(coord: number, size: number, isCenter: boolean): number {
    if (!isCenter) return coord
    return coord - Math.floor(size / 2)
  }

  private compileFont(node: FontNode): RuntimeFont {
    const glyphs = new Map<string, RuntimeFontGlyph>()
    let defaultLineHeight = 1

    for (const glyph of node.glyphs) {
      const advance = Number.isFinite(glyph.advance) ? Math.max(1, Math.trunc(glyph.advance)) : 1
      const { width, height } = this.getBitmapSize(glyph.rows)
      const compiledGlyph: RuntimeFontGlyph = {
        advance,
        rows: [...glyph.rows],
        width,
        height
      }
      glyphs.set(glyph.char, compiledGlyph)
      defaultLineHeight = Math.max(defaultLineHeight, height)
    }

    return {
      name: node.name,
      glyphs,
      fallbackGlyph: glyphs.get('?'),
      defaultLineHeight,
      defaultSpaceAdvance: Math.max(1, Math.floor(defaultLineHeight / 2))
    }
  }

  private builtInMissingGlyph(): RuntimeFontGlyph {
    return {
      advance: 4,
      rows: ['111', '101', '101', '101', '111'],
      width: 3,
      height: 5
    }
  }

  private reportMissingGlyph(fontName: string, char: string): void {
    const codePoint = char.codePointAt(0) ?? 0
    const key = `${fontName}:${codePoint}`
    if (this.missingGlyphErrors.has(key)) return
    this.missingGlyphErrors.add(key)

    const codeHex = codePoint.toString(16).toUpperCase().padStart(4, '0')
    this.addRuntimeError('R014', `Missing glyph in font "${fontName}" for U+${codeHex} (${JSON.stringify(char)}).`)
  }

  private getTextGlyph(font: RuntimeFont, char: string): RuntimeFontGlyph {
    const glyph = font.glyphs.get(char)
    if (glyph) return glyph

    if (char === ' ') {
      return {
        advance: font.defaultSpaceAdvance,
        rows: [],
        width: 0,
        height: 0
      }
    }

    this.reportMissingGlyph(font.name, char)

    if (font.fallbackGlyph) {
      return font.fallbackGlyph
    }
    return this.builtInMissingGlyph()
  }

  private drawTextGlyph(glyph: RuntimeFontGlyph, baseX: number, baseY: number, color: ResolvedColor): void {
    for (let row = 0; row < glyph.rows.length && !this.drawBudgetExceeded; row++) {
      const rowValue = glyph.rows[row]
      for (let col = 0; col < rowValue.length && !this.drawBudgetExceeded; col++) {
        const char = rowValue[col]
        if (char === '.' || char === ' ') continue
        this.drawResolvedPixel(baseX + col, baseY + row, color)
      }
    }
  }

  private executeText(node: TextNode): void {
    const font = this.fonts.get(node.fontName)
    if (!font) {
      this.addRuntimeError('R013', `Unknown font: "${node.fontName}"`)
      return
    }

    const resolvedColor = this.resolveColor(node.color)
    const anchorX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
    const anchorY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
    const tracking = this.evaluateScalar(node.tracking, 'text tracking')
    const lineHeightOverride = this.evaluateScalar(node.lineHeight, 'text lineHeight')
    const lineHeight = lineHeightOverride > 0 ? lineHeightOverride : font.defaultLineHeight
    const wrapWidthRaw = node.wrap === undefined ? undefined : this.evaluateScalar(node.wrap, 'text wrap')
    const wrapWidth = wrapWidthRaw !== undefined && wrapWidthRaw > 0 ? wrapWidthRaw : undefined

    interface PositionedGlyph {
      glyph: RuntimeFontGlyph
      x: number
    }
    interface LayoutLine {
      glyphs: PositionedGlyph[]
      width: number
    }

    const lines: LayoutLine[] = []
    let currentLine: LayoutLine = { glyphs: [], width: 0 }

    const pushLine = (): void => {
      lines.push(currentLine)
      currentLine = { glyphs: [], width: 0 }
    }

    for (let i = 0; i < node.value.length; i++) {
      const char = node.value[i]
      if (char === '\n') {
        pushLine()
        continue
      }

      const glyph = this.getTextGlyph(font, char)
      const spacing = currentLine.glyphs.length > 0 ? tracking : 0
      const nextWidth = currentLine.width + spacing + glyph.advance

      if (wrapWidth !== undefined && currentLine.glyphs.length > 0 && nextWidth > wrapWidth) {
        pushLine()
      }

      const lineSpacing = currentLine.glyphs.length > 0 ? tracking : 0
      const x = currentLine.width + lineSpacing
      currentLine.glyphs.push({ glyph, x })
      currentLine.width = x + glyph.advance
    }
    lines.push(currentLine)

    for (let lineIndex = 0; lineIndex < lines.length && !this.drawBudgetExceeded; lineIndex++) {
      const line = lines[lineIndex]
      let lineStartX = anchorX
      if (node.align === 'center') {
        lineStartX = anchorX - Math.floor(line.width / 2)
      } else if (node.align === 'right') {
        lineStartX = anchorX - Math.max(0, line.width - 1)
      }

      const lineY = anchorY + lineIndex * lineHeight
      for (const glyph of line.glyphs) {
        this.drawTextGlyph(glyph.glyph, lineStartX + glyph.x, lineY, resolvedColor)
      }
    }
  }

  private executeNode(node: ASTNode): void {
    if (this.drawBudgetExceeded) return

    // Track position for error reporting
    this.currentLine = node.pos.line
    this.currentColumn = node.pos.column
    this.currentFilePath = node.pos.filePath
    this.currentCommandName = this.commandNameForNodeKind(node.kind)
    this.currentCommandSourceSpan = this.buildCurrentCommandSourceSpan()
    this.pixelTraceCache.clear()

    switch (node.kind) {
      case 'canvas':
      case 'include':
      case 'palette':
      case 'group':
      case 'font':
      case 'frame':
        // Already handled in first pass or separately.
        // `include` should be resolved by compile stage before runtime.
        if (node.kind === 'include') {
          this.addRuntimeError('R031', 'Unresolved include reached runtime. Compile includes before execution.')
        }
        break

      case 'anchor':
        this.anchors.set(node.name, {
          x: this.evaluateScalar(node.x, 'anchor x'),
          y: this.evaluateScalar(node.y, 'anchor y')
        })
        break

      case 'box': {
        const width = this.evaluateScalar(node.width, 'box width')
        const height = this.evaluateScalar(node.height, 'box height')
        if (width <= 0 || height <= 0) {
          this.addRuntimeError('R034', `Box "${node.name}" must have positive size (got ${width}x${height}).`)
          break
        }
        if (node.dockToBoxPoint && node.boxName) {
          const targetPoint = this.resolveBoxPoint(node.boxName, node.boxPoint)
          if (!targetPoint) break
          const offsetX = this.evaluateScalar(node.x, 'box offset x')
          const offsetY = this.evaluateScalar(node.y, 'box offset y')
          const selectorOffset = this.getBoxSelectorOffset(node.boxPoint, width, height)
          this.boxes.set(node.name, {
            x: targetPoint.x + offsetX - selectorOffset.x,
            y: targetPoint.y + offsetY - selectorOffset.y,
            width,
            height
          })
          break
        }
        const pivotX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
        const pivotY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
        this.boxes.set(node.name, {
          x: this.resolveTopLeft(pivotX, width, node.isCenter),
          y: this.resolveTopLeft(pivotY, height, node.isCenter),
          width,
          height
        })
        break
      }

      case 'let':
      case 'const':
        if (this.frameBuiltinsActive && FRAME_BUILTIN_VAR_NAMES.has(node.name)) {
          this.addRuntimeError('R019', `Cannot redefine built-in frame variable: $${node.name}`)
          break
        }
        {
          const raw = this.evaluateExpr(node.value)
          if (!Number.isFinite(raw)) {
            this.addRuntimeError('R006', 'Expression evaluated to a non-finite number')
            this.setVariable(node.name, 0)
          } else {
            this.setVariable(node.name, raw)
          }
        }
        break

      case 'letpair':
      case 'letvec':
      case 'letsz':
        this.addRuntimeError(
          'R031',
          'Unlowered pair declaration reached runtime. Compile with semantic lowering before execution.'
        )
        break

      case 'letpt': {
        const point = this.resolvePointWithoutCursorUpdate(node.point)
        this.anchors.set(node.name, point)
        break
      }

      case 'defpt': {
        this.addRuntimeError(
          'R031',
          'Unlowered declarative point declaration reached runtime. Compile with semantic lowering before execution.'
        )
        break
      }

      case 'bitmap':
        this.bitmaps.set(node.name, {
          rows: node.rows,
          colorMap: node.colorMap,
          pivot: node.pivot ? { x: node.pivot.x, y: node.pivot.y } : undefined
        })
        break

      case 'tileset':
        this.executeTileset(node)
        break

      case 'tilemap':
        this.executeTilemap(node)
        break

      case 'mirror':
        this.executeMirror(node.axis)
        break

      case 'color':
        this.executeColor(node.color)
        break

      case 'layer':
        this.executeLayer(node.name)
        break

      case 'clear':
        this.executeClear(node.layerName, node.color)
        break

      case 'push':
        this.executePush()
        break

      case 'pop':
        this.executePop()
        break

      case 'cursor': {
        const resolved = this.resolvePoint(node.point)
        this.cursorX = resolved.x
        this.cursorY = resolved.y
        break
      }

      case 'pixel':
        for (const pt of node.points) {
          const resolved = this.resolvePoint(pt)
          this.executePixel(resolved.x, resolved.y, node.color)
        }
        break

      case 'rect':
        {
          const size = this.evaluatePairValues(node.width, node.height, 'rect width', 'rect height')
          const width = size.width
          const height = size.height
          const pivotX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
          const pivotY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
          const x = this.resolveTopLeft(pivotX, width, node.isCenter)
          const y = this.resolveTopLeft(pivotY, height, node.isCenter)
          this.executeRect(
            x,
            y,
            width,
            height,
            node.color
          )
        }
        break

      case 'line':
        this.executeLine(
          this.resolveX(node.x1, node.isCenter1, node.anchorName1, node.isRelativeX1, node.boxName1, node.boxPoint1),
          this.resolveY(node.y1, node.isCenter1, node.anchorName1, node.isRelativeY1, node.boxName1, node.boxPoint1),
          this.resolveX(node.x2, node.isCenter2, node.anchorName2, node.isRelativeX2, node.boxName2, node.boxPoint2),
          this.resolveY(node.y2, node.isCenter2, node.anchorName2, node.isRelativeY2, node.boxName2, node.boxPoint2),
          node.color
        )
        break

      case 'oline':
        this.executeLine(
          this.resolveX(node.x1, node.isCenter1, node.anchorName1, node.isRelativeX1, node.boxName1, node.boxPoint1),
          this.resolveY(node.y1, node.isCenter1, node.anchorName1, node.isRelativeY1, node.boxName1, node.boxPoint1),
          this.resolveX(node.x2, node.isCenter2, node.anchorName2, node.isRelativeX2, node.boxName2, node.boxPoint2),
          this.resolveY(node.y2, node.isCenter2, node.anchorName2, node.isRelativeY2, node.boxName2, node.boxPoint2),
          node.color
        )
        break

      case 'circle':
        this.executeCircle(
          this.resolveX(node.cx, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint),
          this.resolveY(node.cy, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint),
          this.evaluateScalar(node.radius, 'circle radius'),
          node.color
        )
        break

      case 'arc':
        this.executeArc(
          this.resolveX(node.cx, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint),
          this.resolveY(node.cy, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint),
          this.evaluateScalar(node.radius, 'arc radius'),
          this.evaluateScalar(node.startAngle, 'arc start'),
          this.evaluateScalar(node.endAngle, 'arc end'),
          node.color
        )
        break

      case 'stamp': {
        const prevCursorX = this.cursorX
        const prevCursorY = this.cursorY
        const prevMirrorX = this.mirrorX
        const prevMirrorY = this.mirrorY
        const prevDrawAlphaScale = this.drawAlphaScale

        if (node.opacity !== undefined) {
          const opacity = this.evaluateUnitScalar(node.opacity, 'stamp opacity')
          this.drawAlphaScale = Math.max(0, Math.min(1, this.drawAlphaScale * opacity))
        }

        try {
          for (const pt of node.points) {
            const resolved = this.resolvePoint(pt)
            this.executeStamp(
              node.name,
              resolved.x,
              resolved.y,
              node.flipX,
              node.flipY,
              node.rotation,
              node.centerOnTarget,
              node.useTargetPivot
            )
          }
        } finally {
          this.drawAlphaScale = prevDrawAlphaScale
          this.cursorX = prevCursorX
          this.cursorY = prevCursorY
          this.mirrorX = prevMirrorX
          this.mirrorY = prevMirrorY
        }
        break
      }

      case 'repeat':
        this.executeRepeat(node.count, node.dx, node.dy, node.body)
        break

      case 'tile':
        this.executeTile(node)
        break

      case 'map':
        this.executeMap(node)
        break

      case 'scatter':
        this.executeScatter(node)
        break

      case 'emit':
        this.executeEmit(node)
        break

      case 'polygon':
        this.executePolygon(node.points, node.color)
        break

      case 'orect':
        {
          const size = this.evaluatePairValues(node.width, node.height, 'orect width', 'orect height')
          const width = size.width
          const height = size.height
          const pivotX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
          const pivotY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
          const x = this.resolveTopLeft(pivotX, width, node.isCenter)
          const y = this.resolveTopLeft(pivotY, height, node.isCenter)
          this.executeOutlineRect(
            x,
            y,
            width,
            height,
            node.color
          )
        }
        break

      case 'ocirc':
        this.executeOutlineCircle(
          this.resolveX(node.cx, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint),
          this.resolveY(node.cy, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint),
          this.evaluateScalar(node.radius, 'ocirc radius'),
          node.color
        )
        break

      case 'opoly':
        this.executeOutlinePolygon(node.points, node.color)
        break

      case 'fill':
        for (const pt of node.points) {
          const resolved = this.resolvePoint(pt)
          this.executeFill(resolved.x, resolved.y, node.color)
        }
        break

      case 'text':
        this.executeText(node)
        break

      case 'glow':
        this.executeGlow(
          this.resolveX(node.cx, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint),
          this.resolveY(node.cy, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint),
          this.evaluateScalar(node.radius, 'glow radius'),
          node.color
        )
        break

      case 'ellipse':
        {
          const radii = this.evaluatePairValues(node.rx, node.ry, 'ellipse rx', 'ellipse ry')
          this.executeEllipse(
            this.resolveX(node.cx, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint),
            this.resolveY(node.cy, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint),
            radii.width,
            radii.height,
            node.color
          )
        }
        break

      case 'oellipse':
        {
          const radii = this.evaluatePairValues(node.rx, node.ry, 'oellipse rx', 'oellipse ry')
          this.executeOutlineEllipse(
            this.resolveX(node.cx, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint),
            this.resolveY(node.cy, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint),
            radii.width,
            radii.height,
            node.color
          )
        }
        break

      case 'dither':
        this.executeDither(node)
        break
    }
  }

  private resolveColor(color: Color): ResolvedColor {
    if (color.type === 'current') {
      if (!this.hasCurrentColor) {
        this.addRuntimeError('R008', 'No current color set. Use "color <value>" or specify a color on the command.')
        const fallback: ResolvedColor = { type: 'index', value: 0 }
        this.currentColor = fallback
        this.hasCurrentColor = true
        return fallback
      }
      return this.currentColor
    }

    if (color.type === 'hex') {
      const hex = String(color.value)
      if (!isValidHexColorLiteral(hex)) {
        this.reportInvalidHexLiteralOnce(hex, 'draw color')
        const fallback: ResolvedColor = { type: 'index', value: 0 }
        if (!this.hasCurrentColor) {
          this.currentColor = fallback
          this.hasCurrentColor = true
        }
        return fallback
      }
    }

    // If it's a named color, resolve to palette index
    if (color.type === 'name') {
      const name = color.value as string
      const index = this.colorNames.get(name)
      if (index !== undefined) {
        const resolved: ResolvedColor = { type: 'index', value: index }
        this.currentColor = resolved
        this.hasCurrentColor = true
        return resolved
      }
      // Unknown color name - report error and default to index 0
      if (!this.unknownColorNames.has(name)) {
        this.addRuntimeError('R009', `Unknown color name: ${name}`)
        this.unknownColorNames.add(name)
      }
      const fallback: ResolvedColor = { type: 'index', value: 0 }
      if (!this.hasCurrentColor) {
        this.currentColor = fallback
        this.hasCurrentColor = true
      }
      return fallback
    }

    if (color.type === 'index') {
      const index = color.value
      const paletteSize = this.canvas.getPalette().length
      const isValidIndex = Number.isInteger(index) && index >= 0 && index < paletteSize

      if (!isValidIndex) {
        const key = `${index}/${paletteSize}`
        if (!this.invalidPaletteIndexes.has(key)) {
          const maxIndex = Math.max(0, paletteSize - 1)
          this.addRuntimeError('R010', `Palette index out of range: ${index}. Valid range is 0-${maxIndex}.`)
          this.invalidPaletteIndexes.add(key)
        }
        const fallback: ResolvedColor = { type: 'index', value: 0 }
        this.currentColor = fallback
        this.hasCurrentColor = true
        return fallback
      }
    }

    // Already resolved (hex or validated index)
    const resolved: ResolvedColor = { type: color.type, value: color.value }
    this.currentColor = resolved
    this.hasCurrentColor = true
    return resolved
  }

  private executeColor(color: Color): void {
    if (color.type === 'current') {
      this.addRuntimeError('R020', 'Expected a color after "color"')
      return
    }

    const resolved = this.resolveColor(color)
    this.currentColor = resolved
    this.hasCurrentColor = true
  }

  private executeClear(layerName: string | undefined, color: Color | undefined): void {
    const targetLayerName = layerName ?? this.activeLayerName
    const layer = this.ensureLayer(targetLayerName)
    const layerTraces = this.getLayerTraces(targetLayerName)

    if (color === undefined) {
      const changed = this.clearLayerWithBudget(layer, layerTraces)
      if (changed) {
        this.invalidateFlattenedPixelTraces()
      }
      return
    }

    if (color.type === 'current') {
      this.addRuntimeError('R020', 'Expected a color after "clear"')
      return
    }

    const resolvedColor = this.resolveBulkDrawColor(color)
    if (resolvedColor === null) return

    if (this.isResolvedColorTransparent(resolvedColor)) {
      const changed = this.clearLayerWithBudget(layer, layerTraces)
      if (changed) {
        this.invalidateFlattenedPixelTraces()
      }
      return
    }

    const { width, height } = this.canvas.getSize()
    const trace = this.getPixelTraceForLayer(targetLayerName)

    for (let y = 0; y < height && !this.drawBudgetExceeded; y++) {
      for (let x = 0; x < width && !this.drawBudgetExceeded; x++) {
        if (this.consumeDrawBudgetUnits(1) === 0) break
        const key = this.makeLayerPixelKey(x, y)
        layer.set(key, this.cloneResolvedColor(resolvedColor))
        layerTraces.set(key, trace)
      }
    }

    this.invalidateFlattenedPixelTraces()
  }

  private executeMirror(axis: MirrorAxis): void {
    switch (axis) {
      case 'x':
        this.mirrorX = true
        this.mirrorY = false
        break
      case 'y':
        this.mirrorX = false
        this.mirrorY = true
        break
      case 'xy':
        this.mirrorX = true
        this.mirrorY = true
        break
      case 'off':
        this.mirrorX = false
        this.mirrorY = false
        break
    }
  }

  private getMirroredPoints(x: number, y: number): Array<{ x: number; y: number }> {
    if (!this.mirrorX && !this.mirrorY) {
      return [{ x, y }]
    }

    const mirrorX = this.canvasWidth - 1 - x
    const mirrorY = this.canvasHeight - 1 - y
    const points: Array<{ x: number; y: number }> = [{ x, y }]

    if (this.mirrorX && mirrorX !== x) {
      points.push({ x: mirrorX, y })
    }
    if (this.mirrorY && mirrorY !== y) {
      points.push({ x, y: mirrorY })
    }
    if (this.mirrorX && this.mirrorY && mirrorX !== x && mirrorY !== y) {
      points.push({ x: mirrorX, y: mirrorY })
    }

    return points
  }

  private drawResolvedPixel(x: number, y: number, color: ResolvedColor): void {
    if (this.drawBudgetExceeded) return
    this.consumeDrawBudget()
    if (this.drawBudgetExceeded) return

    const scaledColor = this.applyDrawAlphaScale(color)
    if (scaledColor === null) return

    this.setActiveLayerPixel(x, y, scaledColor)

    if (!this.mirrorX && !this.mirrorY) {
      return
    }

    const mirrorX = this.canvasWidth - 1 - x
    const mirrorY = this.canvasHeight - 1 - y

    if (this.mirrorX && mirrorX !== x) {
      this.setActiveLayerPixel(mirrorX, y, scaledColor)
    }
    if (this.mirrorY && mirrorY !== y) {
      this.setActiveLayerPixel(x, mirrorY, scaledColor)
    }
    if (this.mirrorX && this.mirrorY && mirrorX !== x && mirrorY !== y) {
      this.setActiveLayerPixel(mirrorX, mirrorY, scaledColor)
    }
  }

  private applyDrawAlphaScale(color: ResolvedColor): ResolvedColor | null {
    if (this.drawAlphaScale >= 1) return color
    if (this.drawAlphaScale <= 0) return null

    const [r, g, b, a] = this.resolvedColorToRgba(color)
    const scaledAlpha = Math.round(a * this.drawAlphaScale)
    if (scaledAlpha <= 0) return null
    if (scaledAlpha === a) return color
    return this.rgbaToResolvedColor(r, g, b, scaledAlpha)
  }

  private executePixel(x: number, y: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    this.drawResolvedPixel(x, y, resolvedColor)
  }

  private executeRect(x: number, y: number, w: number, h: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    for (let py = y; py < y + h && !this.drawBudgetExceeded; py++) {
      for (let px = x; px < x + w && !this.drawBudgetExceeded; px++) {
        this.drawResolvedPixel(px, py, resolvedColor)
      }
    }
  }

  private executeLineResolved(x1: number, y1: number, x2: number, y2: number, color: ResolvedColor): void {
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const sx = x1 < x2 ? 1 : -1
    const sy = y1 < y2 ? 1 : -1
    let err = dx - dy

    let x = x1
    let y = y1

    while (true) {
      if (this.drawBudgetExceeded) return
      this.drawResolvedPixel(x, y, color)

      if (x === x2 && y === y2) break

      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x += sx
      }
      if (e2 < dx) {
        err += dx
        y += sy
      }
    }
  }

  private executeLine(x1: number, y1: number, x2: number, y2: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    this.executeLineResolved(x1, y1, x2, y2, resolvedColor)
  }

  private executeCircle(cx: number, cy: number, radius: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    for (let y = -radius; y <= radius && !this.drawBudgetExceeded; y++) {
      for (let x = -radius; x <= radius && !this.drawBudgetExceeded; x++) {
        if (x * x + y * y <= radius * radius) {
          this.drawResolvedPixel(cx + x, cy + y, resolvedColor)
        }
      }
    }
  }

  private executeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    if (radius <= 0) {
      this.drawResolvedPixel(cx, cy, resolvedColor)
      return
    }

    const normalizedStart = this.normalizeAngleDegrees(startAngle)
    const normalizedEnd = this.normalizeAngleDegrees(endAngle)
    const fullCircle = this.isArcFullCircle(startAngle, endAngle)

    // Midpoint circle stepping keeps arc perimeter rasterization deterministic.
    let x = radius
    let y = 0
    let err = 1 - radius

    while (x >= y && !this.drawBudgetExceeded) {
      this.drawArcPoint(cx + x, cy + y, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)
      this.drawArcPoint(cx - x, cy + y, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)
      this.drawArcPoint(cx + x, cy - y, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)
      this.drawArcPoint(cx - x, cy - y, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)
      this.drawArcPoint(cx + y, cy + x, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)
      this.drawArcPoint(cx - y, cy + x, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)
      this.drawArcPoint(cx + y, cy - x, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)
      this.drawArcPoint(cx - y, cy - x, cx, cy, normalizedStart, normalizedEnd, fullCircle, resolvedColor)

      y++
      if (err < 0) {
        err += 2 * y + 1
      } else {
        x--
        err += 2 * (y - x) + 1
      }
    }
  }

  private drawArcPoint(
    x: number,
    y: number,
    cx: number,
    cy: number,
    startAngle: number,
    endAngle: number,
    fullCircle: boolean,
    color: ResolvedColor
  ): void {
    if (!fullCircle) {
      const angle = this.pointAngleDegrees(cx, cy, x, y)
      if (!this.isAngleWithinArcSweep(angle, startAngle, endAngle)) {
        return
      }
    }
    this.drawResolvedPixel(x, y, color)
  }

  private pointAngleDegrees(cx: number, cy: number, x: number, y: number): number {
    const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI)
    return this.normalizeAngleDegrees(angle)
  }

  private normalizeAngleDegrees(angle: number): number {
    let normalized = angle % 360
    if (normalized < 0) normalized += 360
    return normalized
  }

  private isArcFullCircle(startAngle: number, endAngle: number): boolean {
    return Math.abs(endAngle - startAngle) >= 360
  }

  private isAngleWithinArcSweep(angle: number, startAngle: number, endAngle: number): boolean {
    if (startAngle <= endAngle) {
      return angle >= startAngle && angle <= endAngle
    }
    return angle >= startAngle || angle <= endAngle
  }

  private executeStamp(
    name: string,
    x: number,
    y: number,
    flipX = false,
    flipY = false,
    rotation: 0 | 90 | 180 | 270 = 0,
    centerOnTarget = false,
    useTargetPivot = false
  ): void {
    // Check for bitmap first
    const bitmapData = this.bitmaps.get(name)
    if (bitmapData) {
      const size = this.getBitmapSize(bitmapData.rows)
      const pivot = useTargetPivot
        ? this.resolveStampPivotOrReport(bitmapData.pivot, `bitmap "${name}"`)
        : null
      if (useTargetPivot && !pivot) {
        return
      }
      const base = this.computeBitmapStampBase(size.width, size.height, x, y, flipX, flipY, rotation, centerOnTarget, pivot)
      const baseX = base.baseX
      const baseY = base.baseY
      this.executeBitmapStamp(bitmapData, baseX, baseY, flipX, flipY, rotation)
      return
    }

    // Check for group
    const group = this.groups.get(name)
    if (!group) {
      this.addRuntimeError('R011', `Unknown stamp target: ${name}`)
      return
    }

    const groupPivot = useTargetPivot
      ? this.resolveStampPivotOrReport(group.pivot, `group "${name}"`)
      : null
    if (useTargetPivot && !groupPivot) {
      return
    }

    if (flipX || flipY || rotation !== 0 || centerOnTarget || useTargetPivot) {
      this.executeTransformedGroupStamp(group.body, x, y, flipX, flipY, rotation, centerOnTarget, groupPivot)
      return
    }

    // Save current offset
    const prevOffsetX = this.offsetX
    const prevOffsetY = this.offsetY
    const prevCursorX = this.cursorX
    const prevCursorY = this.cursorY
    const prevMirrorX = this.mirrorX
    const prevMirrorY = this.mirrorY

    // Apply stamp position as offset
    this.offsetX = x
    this.offsetY = y
    this.cursorX = x
    this.cursorY = y

    // Execute group body
    this.pushVariableScope()
    try {
      for (const stmt of group.body) {
        this.executeNode(stmt)
      }
    } finally {
      this.popVariableScope()
    }

    // Restore offset
    this.offsetX = prevOffsetX
    this.offsetY = prevOffsetY
    this.cursorX = prevCursorX
    this.cursorY = prevCursorY
    this.mirrorX = prevMirrorX
    this.mirrorY = prevMirrorY
  }

  private flattenLayerPixels(layers: Map<string, LayerPixels>, layerOrder: string[]): Map<string, ResolvedColor> {
    const flattened = new Map<string, ResolvedColor>()
    for (const layerName of layerOrder) {
      const layer = layers.get(layerName)
      if (!layer) continue
      for (const [key, color] of layer.entries()) {
        flattened.set(key, this.cloneResolvedColor(color))
      }
    }
    return flattened
  }

  private executeTransformedGroupStamp(
    groupBody: ASTNode[],
    x: number,
    y: number,
    flipX: boolean,
    flipY: boolean,
    rotation: 0 | 90 | 180 | 270,
    centerOnTarget: boolean,
    pivot: { x: number; y: number } | null
  ): void {
    const prevOffsetX = this.offsetX
    const prevOffsetY = this.offsetY
    const prevCursorX = this.cursorX
    const prevCursorY = this.cursorY
    const prevMirrorX = this.mirrorX
    const prevMirrorY = this.mirrorY
    const prevLayers = this.layers
    const prevLayerTraces = this.layerTraces
    const prevLayerOrder = this.layerOrder
    const prevActiveLayerName = this.activeLayerName
    const prevTraceLine = this.currentLine
    const prevTraceColumn = this.currentColumn
    const prevTraceFilePath = this.currentFilePath
    const prevTraceCommand = this.currentCommandName
    const prevTraceSourceSpan = this.cloneSourceSpan(this.currentCommandSourceSpan)

    let capturedPixels = new Map<string, ResolvedColor>()
    const captureLayerName = '__stamp_capture__'

    this.layers = new Map([[captureLayerName, new Map()]])
    this.layerTraces = new Map([[captureLayerName, new Map()]])
    this.layerOrder = [captureLayerName]
    this.activeLayerName = captureLayerName
    this.offsetX = x
    this.offsetY = y
    this.cursorX = x
    this.cursorY = y
    this.mirrorX = prevMirrorX
    this.mirrorY = prevMirrorY

    this.pushVariableScope()
    try {
      for (const stmt of groupBody) {
        this.executeNode(stmt)
      }
      capturedPixels = this.flattenLayerPixels(this.layers, this.layerOrder)
    } finally {
      this.popVariableScope()
      this.layers = prevLayers
      this.layerTraces = prevLayerTraces
      this.layerOrder = prevLayerOrder
      this.activeLayerName = prevActiveLayerName
      this.offsetX = prevOffsetX
      this.offsetY = prevOffsetY
      this.cursorX = prevCursorX
      this.cursorY = prevCursorY
      this.mirrorX = prevMirrorX
      this.mirrorY = prevMirrorY
      this.currentLine = prevTraceLine
      this.currentColumn = prevTraceColumn
      this.currentFilePath = prevTraceFilePath
      this.currentCommandName = prevTraceCommand
      this.currentCommandSourceSpan = prevTraceSourceSpan
      this.ensureLayer(this.activeLayerName)
    }

    if (capturedPixels.size === 0) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const key of capturedPixels.keys()) {
      const pt = this.parseLayerPixelKey(key)
      minX = Math.min(minX, pt.x)
      minY = Math.min(minY, pt.y)
      maxX = Math.max(maxX, pt.x)
      maxY = Math.max(maxY, pt.y)
    }

    const width = maxX - minX + 1
    const height = maxY - minY + 1
    const rotated = rotation === 90 || rotation === 270
    const footprintWidth = rotated ? height : width
    const footprintHeight = rotated ? width : height
    let baseX = x
    let baseY = y
    if (pivot) {
      const transformedPivot = this.transformStampPivot(
        (x + pivot.x) - minX,
        (y + pivot.y) - minY,
        width,
        height,
        flipX,
        flipY,
        rotation
      )
      baseX = x - transformedPivot.x
      baseY = y - transformedPivot.y
    } else if (centerOnTarget) {
      baseX = x - Math.floor(footprintWidth / 2)
      baseY = y - Math.floor(footprintHeight / 2)
    }

    const replayPrevMirrorX = this.mirrorX
    const replayPrevMirrorY = this.mirrorY
    this.mirrorX = false
    this.mirrorY = false

    try {
      for (const [key, color] of capturedPixels.entries()) {
        const { x: px, y: py } = this.parseLayerPixelKey(key)
        let drawCol = px - minX
        let drawRow = py - minY

        drawCol = flipX ? (width - 1 - drawCol) : drawCol
        drawRow = flipY ? (height - 1 - drawRow) : drawRow

        if (rotation === 90) {
          const tmp = drawCol
          drawCol = height - 1 - drawRow
          drawRow = tmp
        } else if (rotation === 180) {
          drawCol = width - 1 - drawCol
          drawRow = height - 1 - drawRow
        } else if (rotation === 270) {
          const tmp = drawCol
          drawCol = drawRow
          drawRow = width - 1 - tmp
        }

        this.drawResolvedPixel(baseX + drawCol, baseY + drawRow, color)
      }
    } finally {
      this.mirrorX = replayPrevMirrorX
      this.mirrorY = replayPrevMirrorY
    }
  }

  private getBitmapSize(rows: string[]): { width: number; height: number } {
    let width = 0
    for (const row of rows) {
      width = Math.max(width, row.length)
    }
    return { width, height: rows.length }
  }

  private resolveStampPivotOrReport(
    pivot: { x: ScalarValue; y: ScalarValue } | undefined,
    targetLabel: string
  ): { x: number; y: number } | null {
    if (!pivot) {
      this.addRuntimeError('R032', `${targetLabel} does not define a pivot for :pivot placement.`)
      return null
    }
    const pair = this.evaluatePairValues(pivot.x, pivot.y, `${targetLabel} pivot x`, `${targetLabel} pivot y`)
    return { x: pair.width, y: pair.height }
  }

  private transformStampPivot(
    pivotX: number,
    pivotY: number,
    width: number,
    height: number,
    flipX: boolean,
    flipY: boolean,
    rotation: 0 | 90 | 180 | 270
  ): { x: number; y: number } {
    let drawCol = flipX ? (width - 1 - pivotX) : pivotX
    let drawRow = flipY ? (height - 1 - pivotY) : pivotY

    if (rotation === 90) {
      const tmp = drawCol
      drawCol = height - 1 - drawRow
      drawRow = tmp
    } else if (rotation === 180) {
      drawCol = width - 1 - drawCol
      drawRow = height - 1 - drawRow
    } else if (rotation === 270) {
      const tmp = drawCol
      drawCol = drawRow
      drawRow = width - 1 - tmp
    }

    return { x: drawCol, y: drawRow }
  }

  private computeBitmapStampBase(
    bitmapWidth: number,
    bitmapHeight: number,
    x: number,
    y: number,
    flipX: boolean,
    flipY: boolean,
    rotation: 0 | 90 | 180 | 270,
    centerOnTarget: boolean,
    pivot: { x: number; y: number } | null
  ): { baseX: number; baseY: number } {
    const rotated = rotation === 90 || rotation === 270
    const footprintWidth = rotated ? bitmapHeight : bitmapWidth
    const footprintHeight = rotated ? bitmapWidth : bitmapHeight

    if (pivot) {
      const transformedPivot = this.transformStampPivot(
        pivot.x,
        pivot.y,
        bitmapWidth,
        bitmapHeight,
        flipX,
        flipY,
        rotation
      )
      return {
        baseX: x - transformedPivot.x,
        baseY: y - transformedPivot.y
      }
    }

    return {
      baseX: centerOnTarget ? x - Math.floor(footprintWidth / 2) : x,
      baseY: centerOnTarget ? y - Math.floor(footprintHeight / 2) : y
    }
  }

  private getTilemapWidth(rows: string[]): number {
    let width = 0
    for (const row of rows) {
      width = Math.max(width, row.length)
    }
    return width
  }

  private hashString(value: string): number {
    let hash = 2166136261 >>> 0
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash | 0
  }

  private selectTilesetVariantTarget(
    variants: RuntimeTilesetVariant[],
    tilesetSeed: number,
    tilemapNameHash: number,
    symbol: string,
    rowIndex: number,
    colIndex: number
  ): string {
    if (variants.length <= 1) {
      return variants[0].target
    }

    const cellSeed =
      (tilesetSeed | 0) ^
      tilemapNameHash ^
      Math.imul(symbol.charCodeAt(0) | 0, 83492791) ^
      Math.imul((rowIndex + 1) | 0, 73856093) ^
      Math.imul((colIndex + 1) | 0, 19349663)
    const rand = this.createSeededRandom(cellSeed)()

    let totalWeight = 0
    for (const variant of variants) {
      totalWeight += Math.max(1, variant.weight)
    }
    if (totalWeight <= 0) {
      return variants[0].target
    }

    let pick = Math.floor(rand * totalWeight)
    for (const variant of variants) {
      const weight = Math.max(1, variant.weight)
      if (pick < weight) {
        return variant.target
      }
      pick -= weight
    }

    return variants[variants.length - 1].target
  }

  private executeTileset(node: TilesetNode): void {
    const rawWidth = node.tileWidth
    const rawHeight = node.tileHeight
    const tileWidth = Math.max(1, Math.floor(rawWidth))
    const tileHeight = Math.max(1, Math.floor(rawHeight))

    if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
      this.addRuntimeError('R030', `Tileset tile size must be greater than 0 (got ${rawWidth}x${rawHeight})`)
    }

    const seed = this.clampScalarRange(
      this.evaluateScalar(node.seed, 'tileset seed'),
      -MAX_ABS_COORD,
      MAX_ABS_COORD,
      'tileset seed'
    )
    const symbols = new Map<string, RuntimeTilesetVariant[]>()
    for (const entry of node.entries) {
      if (entry.symbol.length === 0 || entry.symbol === '.') {
        continue
      }
      const symbol = entry.symbol[0]
      const weightRaw = entry.weight === undefined ? 1 : this.evaluateScalar(entry.weight, 'tileset weight')
      const weight = this.clampScalarRange(weightRaw, 1, MAX_ABS_COORD, 'tileset weight')
      const variants = symbols.get(symbol) ?? []
      variants.push({
        target: entry.target,
        weight
      })
      symbols.set(symbol, variants)
    }

    this.tilesets.set(node.name, {
      tileWidth,
      tileHeight,
      seed,
      symbols
    })
  }

  private executeTilemap(node: TilemapNode): void {
    this.tilemaps.set(node.name, {
      tilesetName: node.tilesetName,
      rows: [...node.rows]
    })
  }

  private executeMap(node: MapNode): void {
    const tilemap = this.tilemaps.get(node.name)
    if (!tilemap) {
      this.addRuntimeError('R027', `Unknown tilemap: "${node.name}"`)
      return
    }

    const tileset = this.tilesets.get(tilemap.tilesetName)
    if (!tileset) {
      this.addRuntimeError('R028', `Unknown tileset "${tilemap.tilesetName}" for tilemap "${node.name}"`)
      return
    }

    if (tileset.tileWidth <= 0 || tileset.tileHeight <= 0) {
      this.addRuntimeError(
        'R030',
        `Tileset tile size must be greater than 0 (got ${tileset.tileWidth}x${tileset.tileHeight})`
      )
      return
    }

    const mapWidth = this.getTilemapWidth(tilemap.rows) * tileset.tileWidth
    const mapHeight = tilemap.rows.length * tileset.tileHeight

    const pivotX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
    const pivotY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
    const startX = this.resolveTopLeft(pivotX, mapWidth, node.isCenter)
    const startY = this.resolveTopLeft(pivotY, mapHeight, node.isCenter)

    const missingTargets = new Set<string>()
    const symbolVariants = new Map<string, RuntimeTilesetVariant[]>()
    for (const [symbol, variants] of tileset.symbols.entries()) {
      const resolvedVariants: RuntimeTilesetVariant[] = []
      for (const variant of variants) {
        if (this.bitmaps.has(variant.target) || this.groups.has(variant.target)) {
          resolvedVariants.push(variant)
          continue
        }
        if (!missingTargets.has(variant.target)) {
          this.addRuntimeError('R011', `Unknown map target "${variant.target}" in tileset "${tilemap.tilesetName}"`)
          missingTargets.add(variant.target)
        }
      }
      if (resolvedVariants.length > 0) {
        symbolVariants.set(symbol, resolvedVariants)
      }
    }

    const unknownSymbols = new Set<string>()
    const tilemapNameHash = this.hashString(node.name)
    const prevCursorX = this.cursorX
    const prevCursorY = this.cursorY

    for (let rowIndex = 0; rowIndex < tilemap.rows.length && !this.drawBudgetExceeded; rowIndex++) {
      const row = tilemap.rows[rowIndex]
      for (let colIndex = 0; colIndex < row.length && !this.drawBudgetExceeded; colIndex++) {
        const symbol = row[colIndex]
        if (symbol === '.' || symbol === ' ') continue

        const variants = symbolVariants.get(symbol)
        if (!variants) {
          if (tileset.symbols.has(symbol)) {
            continue
          }
          if (!unknownSymbols.has(symbol)) {
            this.addRuntimeError(
              'R029',
              `Unknown symbol "${symbol}" in tilemap "${node.name}" for tileset "${tilemap.tilesetName}"`
            )
            unknownSymbols.add(symbol)
          }
          continue
        }

        const target = this.selectTilesetVariantTarget(
          variants,
          tileset.seed,
          tilemapNameHash,
          symbol,
          rowIndex,
          colIndex
        )
        const drawX = startX + colIndex * tileset.tileWidth
        const drawY = startY + rowIndex * tileset.tileHeight
        this.executeStamp(target, drawX, drawY)
      }
    }

    this.cursorX = prevCursorX
    this.cursorY = prevCursorY
  }

  private executeTile(node: TileNode): void {
    const pivotX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
    const pivotY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
    const size = this.evaluatePairValues(node.width, node.height, 'tile width', 'tile height')
    const width = size.width
    const height = size.height

    if (width <= 0 || height <= 0) {
      this.addRuntimeError('R021', 'Tile size must be greater than 0')
      return
    }

    const startX = this.resolveTopLeft(pivotX, width, node.isCenter)
    const startY = this.resolveTopLeft(pivotY, height, node.isCenter)

    const bitmapData = this.bitmaps.get(node.name)
    const hasBitmap = bitmapData !== undefined
    const hasGroup = this.groups.has(node.name)
    if (!hasBitmap && !hasGroup) {
      this.addRuntimeError('R011', `Unknown stamp target: ${node.name}`)
      return
    }

    let stepX: number
    let stepY: number

    if (node.stepX === undefined || node.stepY === undefined) {
      if (!bitmapData) {
        this.addRuntimeError('R022', `Tile step required for group stamps: ${node.name}`)
        return
      }

      const size = this.getBitmapSize(bitmapData.rows)
      if (size.width <= 0 || size.height <= 0) {
        this.addRuntimeError('R023', `Bitmap has no size: ${node.name}`)
        return
      }
      // Rotation swaps bitmap footprint for 90/270, which should also
      // drive default tile step so tiles don't overlap or leave gaps.
      if (node.rotation === 90 || node.rotation === 270) {
        stepX = size.height
        stepY = size.width
      } else {
        stepX = size.width
        stepY = size.height
      }
    } else {
      const step = this.evaluatePairValues(node.stepX, node.stepY, 'tile stepX', 'tile stepY')
      stepX = step.width
      stepY = step.height
    }

    if (stepX <= 0 || stepY <= 0) {
      this.addRuntimeError('R024', 'Tile step must be greater than 0')
      return
    }

    const endX = startX + width
    const endY = startY + height

    const prevCursorX = this.cursorX
    const prevCursorY = this.cursorY

    if (bitmapData && !node.flipX && !node.flipY && node.rotation === 0) {
      const stamp = this.buildResolvedBitmapStamp(bitmapData)
      for (let y = startY; y < endY && !this.drawBudgetExceeded; y += stepY) {
        for (let x = startX; x < endX && !this.drawBudgetExceeded; x += stepX) {
          this.drawResolvedBitmapStamp(stamp, x, y)
        }
      }
      this.cursorX = prevCursorX
      this.cursorY = prevCursorY
      return
    }

    for (let y = startY; y < endY && !this.drawBudgetExceeded; y += stepY) {
      for (let x = startX; x < endX && !this.drawBudgetExceeded; x += stepX) {
        this.executeStamp(node.name, x, y, node.flipX, node.flipY, node.rotation)
      }
    }

    this.cursorX = prevCursorX
    this.cursorY = prevCursorY
  }

  private resolveBitmapCellColor(char: string, colorMap?: Record<string, string>): ResolvedColor | null {
    const code = char.charCodeAt(0)

    // 0-9 always map to palette indices, even when bitmap maps are present.
    if (code >= 48 && code <= 57) {
      return this.resolveColor({ type: 'index', value: code - 48 })
    }

    if (colorMap) {
      const mapped = colorMap[char]
      if (!mapped || mapped === BITMAP_MAP_TRANSPARENT_TOKEN) {
        return null
      }
      return this.resolveColor({ type: 'name', value: mapped })
    }

    // Legacy/default bitmap behavior:
    // a-z => 10..35, A-Z => 36..61 palette indices.
    if (code >= 97 && code <= 122) {
      return this.resolveColor({ type: 'index', value: code - 87 })
    }
    if (code >= 65 && code <= 90) {
      return this.resolveColor({ type: 'index', value: code - 29 })
    }

    return null
  }

  private buildResolvedBitmapStamp(bitmap: RuntimeBitmap): ResolvedBitmapStamp {
    const { rows, colorMap } = bitmap
    const size = this.getBitmapSize(rows)
    const pixels: ResolvedBitmapPixel[] = []

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const char = row[colIdx]
        if (char === '.' || char === ' ') {
          continue
        }

        const color = this.resolveBitmapCellColor(char, colorMap)
        if (!color) {
          continue
        }

        pixels.push({ x: colIdx, y: rowIdx, color })
      }
    }

    return {
      width: size.width,
      height: size.height,
      pixels
    }
  }

  private drawResolvedBitmapStamp(stamp: ResolvedBitmapStamp, baseX: number, baseY: number): void {
    for (const pixel of stamp.pixels) {
      if (this.drawBudgetExceeded) return
      this.drawResolvedPixel(baseX + pixel.x, baseY + pixel.y, pixel.color)
    }
  }

  private executeBitmapStamp(
    bitmap: RuntimeBitmap,
    baseX: number,
    baseY: number,
    flipX = false,
    flipY = false,
    rotation: 0 | 90 | 180 | 270 = 0
  ): void {
    const stamp = this.buildResolvedBitmapStamp(bitmap)

    if (!flipX && !flipY && rotation === 0) {
      this.drawResolvedBitmapStamp(stamp, baseX, baseY)
      return
    }

    for (const pixel of stamp.pixels) {
      if (this.drawBudgetExceeded) return

      let drawCol = flipX ? (stamp.width - 1 - pixel.x) : pixel.x
      let drawRow = flipY ? (stamp.height - 1 - pixel.y) : pixel.y

      if (rotation === 90) {
        const tmp = drawCol
        drawCol = stamp.height - 1 - drawRow
        drawRow = tmp
      } else if (rotation === 180) {
        drawCol = stamp.width - 1 - drawCol
        drawRow = stamp.height - 1 - drawRow
      } else if (rotation === 270) {
        const tmp = drawCol
        drawCol = drawRow
        drawRow = stamp.width - 1 - tmp
      }

      this.drawResolvedPixel(baseX + drawCol, baseY + drawRow, pixel.color)
    }
  }

  private executeRepeat(count: ScalarValue, dx: ScalarValue, dy: ScalarValue, body: ASTNode[]): void {
    const resolvedCount = this.evaluateScalar(count, 'repeat count')
    const step = this.evaluatePairValues(dx, dy, 'repeat dx', 'repeat dy')
    const resolvedDx = step.width
    const resolvedDy = step.height

    if (resolvedCount <= 0) {
      return
    }

    const prevOffsetX = this.offsetX
    const prevOffsetY = this.offsetY
    const prevCursorX = this.cursorX
    const prevCursorY = this.cursorY
    const prevMirrorX = this.mirrorX
    const prevMirrorY = this.mirrorY

    for (let i = 0; i < resolvedCount && !this.drawBudgetExceeded; i++) {
      this.offsetX = prevOffsetX + i * resolvedDx
      this.offsetY = prevOffsetY + i * resolvedDy
      this.cursorX = this.offsetX
      this.cursorY = this.offsetY
      this.mirrorX = prevMirrorX
      this.mirrorY = prevMirrorY

      this.pushVariableScope({ i })
      try {
        for (const stmt of body) {
          this.executeNode(stmt)
        }
      } finally {
        this.popVariableScope()
      }
    }

    this.offsetX = prevOffsetX
    this.offsetY = prevOffsetY
    this.cursorX = prevCursorX
    this.cursorY = prevCursorY
    this.mirrorX = prevMirrorX
    this.mirrorY = prevMirrorY
  }

  private executePolygon(
    points: Point[],
    color: Color
  ): void {
    // Resolve all points
    const resolvedPoints = points.map(p => this.resolvePoint(p))
    const resolvedColor = this.resolveColor(color)

    if (resolvedPoints.length < 3) return

    // Find bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of resolvedPoints) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }

    // Scanline fill with mirroring support
    for (let y = Math.floor(minY); y <= Math.ceil(maxY) && !this.drawBudgetExceeded; y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX) && !this.drawBudgetExceeded; x++) {
        if (this.consumeDrawBudgetUnits(1) === 0) break
        if (this.pointInPolygon(x, y, resolvedPoints)) {
          this.drawResolvedPixel(x, y, resolvedColor)
        }
      }
    }
  }

  private pointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
    let inside = false
    const n = points.length

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = points[i].x, yi = points[i].y
      const xj = points[j].x, yj = points[j].y

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }

    return inside
  }

  private executeOutlineRect(x: number, y: number, w: number, h: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    // Top edge
    for (let px = x; px < x + w && !this.drawBudgetExceeded; px++) {
      this.drawResolvedPixel(px, y, resolvedColor)
    }
    // Bottom edge
    for (let px = x; px < x + w && !this.drawBudgetExceeded; px++) {
      this.drawResolvedPixel(px, y + h - 1, resolvedColor)
    }
    // Left edge (excluding corners already drawn)
    for (let py = y + 1; py < y + h - 1 && !this.drawBudgetExceeded; py++) {
      this.drawResolvedPixel(x, py, resolvedColor)
    }
    // Right edge (excluding corners already drawn)
    for (let py = y + 1; py < y + h - 1 && !this.drawBudgetExceeded; py++) {
      this.drawResolvedPixel(x + w - 1, py, resolvedColor)
    }
  }

  private executeOutlineCircle(cx: number, cy: number, radius: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    if (radius <= 0) {
      this.drawResolvedPixel(cx, cy, resolvedColor)
      return
    }

    // Midpoint circle algorithm
    let x = radius
    let y = 0
    let err = 1 - radius

    while (x >= y && !this.drawBudgetExceeded) {
      // Draw 8 octant points
      this.drawResolvedPixel(cx + x, cy + y, resolvedColor)
      this.drawResolvedPixel(cx - x, cy + y, resolvedColor)
      this.drawResolvedPixel(cx + x, cy - y, resolvedColor)
      this.drawResolvedPixel(cx - x, cy - y, resolvedColor)
      this.drawResolvedPixel(cx + y, cy + x, resolvedColor)
      this.drawResolvedPixel(cx - y, cy + x, resolvedColor)
      this.drawResolvedPixel(cx + y, cy - x, resolvedColor)
      this.drawResolvedPixel(cx - y, cy - x, resolvedColor)

      y++
      if (err < 0) {
        err += 2 * y + 1
      } else {
        x--
        err += 2 * (y - x) + 1
      }
    }
  }

  private executeOutlinePolygon(points: Point[], color: Color): void {
    const resolvedPoints = points.map(p => this.resolvePoint(p))
    const resolvedColor = this.resolveColor(color)

    if (resolvedPoints.length < 2) return

    // Draw lines between consecutive points, closing the polygon
    for (let i = 0; i < resolvedPoints.length && !this.drawBudgetExceeded; i++) {
      const from = resolvedPoints[i]
      const to = resolvedPoints[(i + 1) % resolvedPoints.length]
      this.executeLineResolved(from.x, from.y, to.x, to.y, resolvedColor)
    }
  }

  private executeGlow(cx: number, cy: number, radius: number, color: Color): void {
    if (radius <= 0) return
    const resolvedColor = this.resolveColor(color)

    // Get the base RGB from the resolved color
    let r: number, g: number, b: number, baseAlpha: number
    if (resolvedColor.type === 'hex') {
      const hex = String(resolvedColor.value)
      const parsed = this.parseHexToRgba(hex)
      r = parsed[0]; g = parsed[1]; b = parsed[2]; baseAlpha = parsed[3]
    } else {
      const palette = this.canvas.getPalette()
      const hex = palette[resolvedColor.value as number] || '#000000'
      const parsed = this.parseHexToRgba(hex)
      r = parsed[0]; g = parsed[1]; b = parsed[2]; baseAlpha = parsed[3]
    }

    for (let dy = -radius; dy <= radius && !this.drawBudgetExceeded; dy++) {
      for (let dx = -radius; dx <= radius && !this.drawBudgetExceeded; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > radius) continue

        const t = dist / radius
        const alpha = Math.round(baseAlpha * (1 - t))
        if (alpha <= 0) continue

        const alphaHex = alpha.toString(16).padStart(2, '0')
        const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${alphaHex}`
        const glowColor: ResolvedColor = { type: 'hex', value: hexColor }
        this.drawResolvedPixel(cx + dx, cy + dy, glowColor)
      }
    }
  }

  private parseHexToRgba(hex: string): [number, number, number, number] {
    return parseHexColorLiteral(hex) ?? [0, 0, 0, 255]
  }

  private executeEllipse(cx: number, cy: number, rx: number, ry: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    if (rx <= 0 || ry <= 0) {
      this.drawResolvedPixel(cx, cy, resolvedColor)
      return
    }
    for (let dy = -ry; dy <= ry && !this.drawBudgetExceeded; dy++) {
      for (let dx = -rx; dx <= rx && !this.drawBudgetExceeded; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          this.drawResolvedPixel(cx + dx, cy + dy, resolvedColor)
        }
      }
    }
  }

  private executeOutlineEllipse(cx: number, cy: number, rx: number, ry: number, color: Color): void {
    const resolvedColor = this.resolveColor(color)
    if (rx <= 0 || ry <= 0) {
      this.drawResolvedPixel(cx, cy, resolvedColor)
      return
    }

    // Midpoint ellipse algorithm
    let x = 0
    let y = ry
    const rx2 = rx * rx
    const ry2 = ry * ry
    const twoRx2 = 2 * rx2
    const twoRy2 = 2 * ry2
    let px = 0
    let py = twoRx2 * y

    // Plot initial 4-symmetric points
    this.drawEllipsePoints(cx, cy, x, y, resolvedColor)

    // Region 1: slope magnitude < 1
    let d1 = ry2 - rx2 * ry + 0.25 * rx2
    while (px < py && !this.drawBudgetExceeded) {
      x++
      px += twoRy2
      if (d1 < 0) {
        d1 += ry2 + px
      } else {
        y--
        py -= twoRx2
        d1 += ry2 + px - py
      }
      this.drawEllipsePoints(cx, cy, x, y, resolvedColor)
    }

    // Region 2: slope magnitude >= 1
    let d2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2
    while (y > 0 && !this.drawBudgetExceeded) {
      y--
      py -= twoRx2
      if (d2 > 0) {
        d2 += rx2 - py
      } else {
        x++
        px += twoRy2
        d2 += rx2 - py + px
      }
      this.drawEllipsePoints(cx, cy, x, y, resolvedColor)
    }
  }

  private drawEllipsePoints(cx: number, cy: number, x: number, y: number, color: ResolvedColor): void {
    this.drawResolvedPixel(cx + x, cy + y, color)
    this.drawResolvedPixel(cx - x, cy + y, color)
    this.drawResolvedPixel(cx + x, cy - y, color)
    this.drawResolvedPixel(cx - x, cy - y, color)
  }

  private executeDither(node: DitherNode): void {
    const size = this.evaluatePairValues(node.width, node.height, 'dither width', 'dither height')
    const width = size.width
    const height = size.height
    if (width <= 0 || height <= 0) return

    const seed = this.evaluateScalar(node.seed, 'dither seed')
    const colorA = this.resolveColor(node.colorA)
    const colorB = this.resolveColor(node.colorB)
    const pivotX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
    const pivotY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
    const startX = this.resolveTopLeft(pivotX, width, node.isCenter)
    const startY = this.resolveTopLeft(pivotY, height, node.isCenter)

    const bayer4x4 = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5]
    ]
    const checkerOffsetX = seed & 1
    const checkerOffsetY = (seed >>> 1) & 1
    const bayerOffsetX = seed & 3
    const bayerOffsetY = (seed >>> 2) & 3

    for (let y = 0; y < height && !this.drawBudgetExceeded; y++) {
      for (let x = 0; x < width && !this.drawBudgetExceeded; x++) {
        const px = startX + x
        const py = startY + y
        let useColorB = false

        switch (node.mode) {
          case 'checker':
            useColorB = (((x + checkerOffsetX) + (y + checkerOffsetY)) & 1) === 1
            break
          case 'bayer': {
            const tx = (x + bayerOffsetX) & 3
            const ty = (y + bayerOffsetY) & 3
            useColorB = bayer4x4[ty][tx] >= 8
            break
          }
          case 'noise':
            useColorB = hashCoordsToUnit(px, py, seed) >= 0.5
            break
        }

        this.drawResolvedPixel(px, py, useColorB ? colorB : colorA)
      }
    }
  }

  private executeFill(x: number, y: number, color: Color): void {
    const resolvedColor = this.resolveBulkDrawColor(color)
    if (resolvedColor === null) return

    const points = this.getMirroredPoints(x, y)
    for (const pt of points) {
      this.fillActiveLayer(pt.x, pt.y, resolvedColor)
      if (this.drawBudgetExceeded) break
    }
  }

  getCanvasSize(): { width: number; height: number } {
    return this.canvas.getSize()
  }

  getPixelTrace(x: number, y: number): PixelTrace | null {
    const { width, height } = this.canvas.getSize()
    if (x < 0 || x >= width || y < 0 || y >= height) return null

    if (this.flattenedPixelTraces === null) {
      this.flattenedPixelTraces = this.buildFlattenedPixelTraces()
    }

    const key = this.makeLayerPixelKey(x, y)
    const trace = this.flattenedPixelTraces.get(key)
    return trace ? this.clonePixelTrace(trace) : null
  }

  getPaletteColorNames(): Map<string, number> {
    return new Map(this.colorNames)
  }

  getPaletteSlots(): PaletteSlot[] {
    const cloneSpan = (span: SourceSpan | undefined): SourceSpan | undefined => {
      if (!span) return undefined
      return {
        start: { ...span.start },
        end: { ...span.end }
      }
    }

    return this.paletteSlots.map((slot) => ({
      ...slot,
      sourceSpan: cloneSpan(slot.sourceSpan),
      hexSpan: cloneSpan(slot.hexSpan),
      hexEndSpan: cloneSpan(slot.hexEndSpan),
      stepsSpan: cloneSpan(slot.stepsSpan)
    }))
  }

  private createSeededRandom(seed: number): () => number {
    // mulberry32
    let s = seed | 0
    return (): number => {
      s = (s + 0x6D2B79F5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  private executeScatter(node: ScatterNode): void {
    const startX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
    const startY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
    const size = this.evaluatePairValues(node.width, node.height, 'scatter width', 'scatter height')
    const width = size.width
    const height = size.height
    const count = this.evaluateScalar(node.count, 'scatter count')
    const seed = this.evaluateScalar(node.seed, 'scatter seed')

    if (width <= 0 || height <= 0 || count <= 0) return

    const rand = this.createSeededRandom(seed)

    for (let i = 0; i < count && !this.drawBudgetExceeded; i++) {
      const x = startX + Math.floor(rand() * width)
      const y = startY + Math.floor(rand() * height)
      this.executeStamp(node.name, x, y)
    }
  }

  private resolveEmitWindow(activeStart?: number, activeEnd?: number, life?: number): { start: number; end: number } {
    let start = Number.NEGATIVE_INFINITY
    let end = Number.POSITIVE_INFINITY

    if (activeStart !== undefined || activeEnd !== undefined) {
      const rangeStart = activeStart ?? activeEnd ?? 0
      const rangeEnd = activeEnd ?? activeStart ?? 0
      start = Math.min(rangeStart, rangeEnd)
      end = Math.max(rangeStart, rangeEnd)
    }

    if (life !== undefined) {
      start = Math.max(start, 0)
      end = Math.min(end, life - 1)
    }

    return { start, end }
  }

  private resolveEmitAlphaScale(node: EmitNode, sampleTime: number, windowStart: number, windowEnd: number): number | null {
    if (sampleTime < windowStart || sampleTime > windowEnd) {
      return null
    }

    if (!node.fade) {
      return 1
    }

    const hasBoundedWindow = Number.isFinite(windowStart) && Number.isFinite(windowEnd)
    if (!hasBoundedWindow) {
      const warningKey = `${node.pos.filePath ?? ''}:${node.pos.line}:${node.pos.column}`
      if (!this.emitFadeWindowWarnings.has(warningKey)) {
        this.emitFadeWindowWarnings.add(warningKey)
        this.addRuntimeError(
          'R025',
          'Emit fade requires a bounded window from life or active; draw uses full alpha.',
          node.pos.line,
          node.pos.column
        )
      }
      return 1
    }

    const span = Math.max(1, windowEnd - windowStart + 1)
    const alpha = Math.max(0, Math.min(1, (windowEnd - sampleTime + 1) / span))
    return alpha > 0 ? alpha : null
  }

  private wrapEmitTime(time: number, loopLength: number): number {
    const wrapped = time % loopLength
    return wrapped < 0 ? wrapped + loopLength : wrapped
  }

  private executeEmit(node: EmitNode): void {
    const originX = this.resolveX(node.x, node.isCenter, node.anchorName, node.isRelativeX, node.boxName, node.boxPoint)
    const originY = this.resolveY(node.y, node.isCenter, node.anchorName, node.isRelativeY, node.boxName, node.boxPoint)
    const count = this.evaluateScalar(node.count, 'emit count')
    const spreadPair = this.evaluatePairValues(node.spreadWidth, node.spreadHeight, 'emit spread width', 'emit spread height')
    const spreadWidthRaw = spreadPair.width
    const spreadHeightRaw = spreadPair.height
    const spreadWidth = this.clampScalarRange(spreadWidthRaw, 0, MAX_EXTENT, 'emit spread width')
    const spreadHeight = this.clampScalarRange(spreadHeightRaw, 0, MAX_EXTENT, 'emit spread height')
    const driftPair = this.evaluatePairValues(node.driftX, node.driftY, 'emit driftX', 'emit driftY')
    const driftX = this.clampScalarRange(
      driftPair.width,
      -MAX_ABS_COORD,
      MAX_ABS_COORD,
      'emit driftX'
    )
    const driftY = this.clampScalarRange(
      driftPair.height,
      -MAX_ABS_COORD,
      MAX_ABS_COORD,
      'emit driftY'
    )
    const velocityPair = this.evaluatePairValues(node.velX, node.velY, 'emit velX', 'emit velY')
    const velX = this.clampScalarRange(
      velocityPair.width,
      -MAX_ABS_COORD,
      MAX_ABS_COORD,
      'emit velX'
    )
    const velY = this.clampScalarRange(
      velocityPair.height,
      -MAX_ABS_COORD,
      MAX_ABS_COORD,
      'emit velY'
    )
    const jitterPair = this.evaluatePairValues(node.jitterX, node.jitterY, 'emit jitterX', 'emit jitterY')
    const jitterX = this.clampScalarRange(
      jitterPair.width,
      0,
      MAX_ABS_COORD,
      'emit jitterX'
    )
    const jitterY = this.clampScalarRange(
      jitterPair.height,
      0,
      MAX_ABS_COORD,
      'emit jitterY'
    )
    const activeStart = node.activeStart === undefined
      ? undefined
      : this.clampScalarRange(
          this.evaluateScalar(node.activeStart, 'emit active start'),
          -MAX_ABS_COORD,
          MAX_ABS_COORD,
          'emit active start'
        )
    const activeEnd = node.activeEnd === undefined
      ? undefined
      : this.clampScalarRange(
          this.evaluateScalar(node.activeEnd, 'emit active end'),
          -MAX_ABS_COORD,
          MAX_ABS_COORD,
          'emit active end'
        )
    const life = node.life === undefined
      ? undefined
      : this.clampScalarRange(
          this.evaluateScalar(node.life, 'emit life'),
          0,
          MAX_ABS_COORD,
          'emit life'
        )
    const loopLength = node.loop === undefined
      ? undefined
      : this.clampScalarRange(
          this.evaluateScalar(node.loop, 'emit loop'),
          1,
          MAX_ABS_COORD,
          'emit loop'
        )
    const seed = this.evaluateScalar(node.seed, 'emit seed')
    const defaultDriftTime = this.frameBuiltinsActive ? (this.getVariable('frame') ?? 0) : 0
    const driftTime = node.driftTime === undefined
      ? defaultDriftTime
      : this.clampScalarRange(
          this.evaluateScalar(node.driftTime, 'emit time'),
          -MAX_ABS_COORD,
          MAX_ABS_COORD,
          'emit time'
        )

    if (count <= 0) return
    if (life !== undefined && life <= 0) return

    const { start: windowStart, end: windowEnd } = this.resolveEmitWindow(activeStart, activeEnd, life)
    if (windowEnd < windowStart) return

    const rand = this.createSeededRandom(seed)
    const spreadXMin = -Math.floor(spreadWidth / 2)
    const spreadYMin = -Math.floor(spreadHeight / 2)

    const prevCursorX = this.cursorX
    const prevCursorY = this.cursorY
    const prevDrawAlphaScale = this.drawAlphaScale

    try {
      for (let i = 0; i < count && !this.drawBudgetExceeded; i++) {
        const spreadX = spreadWidth > 0 ? spreadXMin + Math.floor(rand() * spreadWidth) : 0
        const spreadY = spreadHeight > 0 ? spreadYMin + Math.floor(rand() * spreadHeight) : 0
        const jitterVelX = jitterX > 0 ? Math.floor(rand() * (jitterX * 2 + 1)) - jitterX : 0
        const jitterVelY = jitterY > 0 ? Math.floor(rand() * (jitterY * 2 + 1)) - jitterY : 0
        const phase = loopLength === undefined || loopLength <= 1
          ? 0
          : Math.floor(rand() * loopLength)
        const particleTime = loopLength === undefined
          ? driftTime
          : this.wrapEmitTime(driftTime + phase, loopLength)
        const emitAlphaScale = this.resolveEmitAlphaScale(node, particleTime, windowStart, windowEnd)
        if (emitAlphaScale === null) continue

        const driftOffsetX = driftX * particleTime
        const driftOffsetY = driftY * particleTime
        const velocityOffsetX = (velX + jitterVelX) * particleTime
        const velocityOffsetY = (velY + jitterVelY) * particleTime
        this.drawAlphaScale = Math.max(0, Math.min(1, prevDrawAlphaScale * emitAlphaScale))
        this.executeStamp(
          node.name,
          originX + spreadX + driftOffsetX + velocityOffsetX,
          originY + spreadY + driftOffsetY + velocityOffsetY
        )
      }
    } finally {
      this.drawAlphaScale = prevDrawAlphaScale
      this.cursorX = prevCursorX
      this.cursorY = prevCursorY
    }
  }

  private interpolateColors(hexStart: string, hexEnd: string, steps: number): string[] {
    const parseHex = (hex: string): [number, number, number] => {
      let h = hex.startsWith('#') ? hex.slice(1) : hex
      // Expand shorthand (#f00 → ff0000)
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16)
      ]
    }

    const [r1, g1, b1] = parseHex(hexStart)
    const [r2, g2, b2] = parseHex(hexEnd)
    const result: string[] = []

    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 0 : i / (steps - 1)
      const r = Math.round(r1 + (r2 - r1) * t)
      const g = Math.round(g1 + (g2 - g1) * t)
      const b = Math.round(b1 + (b2 - b1) * t)
      result.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`)
    }

    return result
  }
}
