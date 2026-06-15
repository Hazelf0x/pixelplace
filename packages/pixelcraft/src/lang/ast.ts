import type { ExpressionIntrinsicName } from './expression-intrinsics'

export interface Position {
  line: number
  column: number
  filePath?: string
}

export interface SourceSpan {
  start: Position
  end: Position
}

export type BinaryOp = '+' | '-' | '*' | '/' | '%'
export type UnaryOp = '+' | '-'
export type ExprIntrinsic = ExpressionIntrinsicName

export interface LiteralExpr {
  kind: 'literal'
  value: number
}

export interface VariableExpr {
  kind: 'var'
  name: string
  pos?: Position
}

export interface PairReferenceExpr {
  kind: 'pairVar'
  name: string
  pos?: Position
}

export interface UnaryExpr {
  kind: 'unary'
  op: UnaryOp
  expr: Expr
}

export interface BinaryExpr {
  kind: 'binary'
  op: BinaryOp
  left: Expr
  right: Expr
}

export interface CallExpr {
  kind: 'call'
  name: ExprIntrinsic
  args: Expr[]
}

export type Expr = LiteralExpr | VariableExpr | PairReferenceExpr | UnaryExpr | BinaryExpr | CallExpr
export type ScalarValue = number | Expr

export type Color =
  | { type: 'hex'; value: string }      // hex string
  | { type: 'index'; value: number }    // palette index
  | { type: 'name'; value: string }     // color name
  | { type: 'current' }                 // use current color state

// Color that has been resolved (name converted to index)
export interface ResolvedColor {
  type: 'hex' | 'index'
  value: string | number
}

// Coordinate can be numeric or 'center', with optional relative positioning
export interface Coordinate {
  type: 'numeric' | 'center'
  x: ScalarValue  // resolved x (0 for center until runtime)
  y: ScalarValue  // resolved y (0 for center until runtime)
  isCenter: boolean
}

export type BoxPointSelector =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'

// Point used in multi-point commands (px, fill, stamp, poly)
export interface Point {
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string  // if set, x/y are offsets from this anchor
  anchorPos?: Position
  boxName?: string
  boxPoint?: BoxPointSelector
  boxPos?: Position
}

export interface CanvasNode {
  kind: 'canvas'
  width: number
  height: number
  pos: Position
}

export interface PaletteEntry {
  name?: string     // optional name (e.g., "skin", "bg")
  hex: string       // hex color value (start color for gradients)
  hexEnd?: string   // end hex color for gradient ranges
  steps?: number    // number of gradient steps (default 2 = just start and end)
  presetName?: string
  presetColorIndex?: number
  sourceSpan?: SourceSpan
  hexSpan?: SourceSpan
  hexEndSpan?: SourceSpan
  stepsSpan?: SourceSpan
}

export interface PaletteNode {
  kind: 'palette'
  append: boolean
  colors: PaletteEntry[]  // hex colors with optional names
  pos: Position
}

export interface IncludeNode {
  kind: 'include'
  path: string
  fromWithLayerScope?: boolean
  pos: Position
}

export interface PixelNode {
  kind: 'pixel'
  points: Point[]
  color: Color
  pos: Position
}

export interface RectNode {
  kind: 'rect'
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  width: ScalarValue
  height: ScalarValue
  color: Color
  pos: Position
}

export interface OutlineRectNode {
  kind: 'orect'
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  width: ScalarValue
  height: ScalarValue
  color: Color
  pos: Position
}

export interface LineNode {
  kind: 'line'
  x1: ScalarValue
  y1: ScalarValue
  isCenter1: boolean
  isRelativeX1: boolean
  isRelativeY1: boolean
  anchorName1?: string
  boxName1?: string
  boxPoint1?: BoxPointSelector
  x2: ScalarValue
  y2: ScalarValue
  isCenter2: boolean
  isRelativeX2: boolean
  isRelativeY2: boolean
  anchorName2?: string
  boxName2?: string
  boxPoint2?: BoxPointSelector
  color: Color
  pos: Position
}

export interface OutlineLineNode {
  kind: 'oline'
  x1: ScalarValue
  y1: ScalarValue
  isCenter1: boolean
  isRelativeX1: boolean
  isRelativeY1: boolean
  anchorName1?: string
  boxName1?: string
  boxPoint1?: BoxPointSelector
  x2: ScalarValue
  y2: ScalarValue
  isCenter2: boolean
  isRelativeX2: boolean
  isRelativeY2: boolean
  anchorName2?: string
  boxName2?: string
  boxPoint2?: BoxPointSelector
  color: Color
  pos: Position
}

export interface CircleNode {
  kind: 'circle'
  cx: ScalarValue
  cy: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  radius: ScalarValue
  color: Color
  pos: Position
}

export interface ArcNode {
  kind: 'arc'
  cx: ScalarValue
  cy: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  radius: ScalarValue
  startAngle: ScalarValue
  endAngle: ScalarValue
  color: Color
  pos: Position
}

export interface OutlineCircleNode {
  kind: 'ocirc'
  cx: ScalarValue
  cy: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  radius: ScalarValue
  color: Color
  pos: Position
}

export type MirrorAxis = 'x' | 'y' | 'xy' | 'off'

export interface MirrorNode {
  kind: 'mirror'
  axis: MirrorAxis
  pos: Position
}

export interface GroupNode {
  kind: 'group'
  name: string
  pivot?: StampPivot
  body: ASTNode[]
  pos: Position
}

export interface StampPivot {
  x: ScalarValue
  y: ScalarValue
}

export interface StampNode {
  kind: 'stamp'
  name: string
  points: Point[]
  opacity?: ScalarValue
  centerOnTarget: boolean
  useTargetPivot: boolean
  flipX: boolean
  flipY: boolean
  rotation: 0 | 90 | 180 | 270
  pos: Position
}

export interface RepeatNode {
  kind: 'repeat'
  count: ScalarValue
  dx: ScalarValue
  dy: ScalarValue
  offsetSyntax?: 'default' | 'legacy' | 'step'
  body: ASTNode[]
  pos: Position
}

export interface PolygonNode {
  kind: 'polygon'
  points: Point[]
  color: Color
  pos: Position
}

export interface OutlinePolygonNode {
  kind: 'opoly'
  points: Point[]
  color: Color
  pos: Position
}

export interface FillNode {
  kind: 'fill'
  points: Point[]
  color: Color
  pos: Position
}

export interface FrameNode {
  kind: 'frame'
  frameNumber: number
  duration: number
  body: ASTNode[]
  pos: Position
}

export interface AnchorNode {
  kind: 'anchor'
  name: string
  x: ScalarValue
  y: ScalarValue
  pos: Position
}

export interface BoxNode {
  kind: 'box'
  name: string
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  dockToBoxPoint?: boolean
  width: ScalarValue
  height: ScalarValue
  pos: Position
}

export interface LetNode {
  kind: 'let'
  name: string
  value: Expr
  pos: Position
}

export interface ConstNode {
  kind: 'const'
  name: string
  value: Expr
  pos: Position
}

export type PairAliasKind = 'pair' | 'vec' | 'size'

export interface LetPairNode {
  kind: 'letpair' | 'letvec' | 'letsz'
  aliasKind: PairAliasKind
  name: string
  width: ScalarValue
  height: ScalarValue
  pos: Position
}

export interface LetPointNode {
  kind: 'letpt'
  name: string
  point: Point
  pos: Position
}

export interface DefPointNode {
  kind: 'defpt'
  name: string
  point: Point
  pos: Position
}

export interface BitmapNode {
  kind: 'bitmap'
  name: string
  pivot?: StampPivot
  rows: string[]  // each string is a row of pixels
  rowSpans: SourceSpan[]  // source spans for row string contents (without quotes)
  colorMap?: Record<string, string>  // map char -> color name or "transparent" (e.g. { B: 'fin', H: 'transparent' })
  pos: Position
}

export interface FontGlyphNode {
  char: string
  advance: number
  rows: string[]
  pos: Position
}

export interface FontNode {
  kind: 'font'
  name: string
  glyphs: FontGlyphNode[]
  pos: Position
}

export interface ColorNode {
  kind: 'color'
  color: Color
  pos: Position
}

export interface CursorNode {
  kind: 'cursor'
  point: Point
  pos: Position
}

export interface TileNode {
  kind: 'tile'
  name: string
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  width: ScalarValue
  height: ScalarValue
  stepX?: ScalarValue
  stepY?: ScalarValue
  flipX: boolean
  flipY: boolean
  rotation: 0 | 90 | 180 | 270
  pos: Position
}

export interface TilesetEntry {
  symbol: string
  target: string
  weight?: ScalarValue
  pos: Position
}

export interface TilesetNode {
  kind: 'tileset'
  name: string
  tileWidth: number
  tileHeight: number
  seed: ScalarValue
  entries: TilesetEntry[]
  pos: Position
}

export interface TilemapNode {
  kind: 'tilemap'
  name: string
  tilesetName: string
  rows: string[]
  rowSpans: SourceSpan[]
  pos: Position
}

export interface MapNode {
  kind: 'map'
  name: string
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  pos: Position
}

export type TextAlign = 'left' | 'center' | 'right'

export interface TextNode {
  kind: 'text'
  value: string
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  fontName: string
  color: Color
  align: TextAlign
  tracking: ScalarValue
  lineHeight: ScalarValue
  wrap?: ScalarValue
  pos: Position
}

export interface LayerNode {
  kind: 'layer'
  name: string
  pos: Position
}

export interface ClearNode {
  kind: 'clear'
  layerName?: string
  color?: Color
  pos: Position
}

export interface PushNode {
  kind: 'push'
  pos: Position
}

export interface PopNode {
  kind: 'pop'
  pos: Position
}

export interface ScatterNode {
  kind: 'scatter'
  name: string
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  width: ScalarValue
  height: ScalarValue
  count: ScalarValue
  seed: ScalarValue
  pos: Position
}

export interface EmitNode {
  kind: 'emit'
  name: string
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  count: ScalarValue
  spreadWidth: ScalarValue
  spreadHeight: ScalarValue
  driftX: ScalarValue
  driftY: ScalarValue
  driftTime?: ScalarValue
  velX: ScalarValue
  velY: ScalarValue
  jitterX: ScalarValue
  jitterY: ScalarValue
  activeStart?: ScalarValue
  activeEnd?: ScalarValue
  life?: ScalarValue
  loop?: ScalarValue
  fade: boolean
  seed: ScalarValue
  pos: Position
}

export interface GlowNode {
  kind: 'glow'
  cx: ScalarValue
  cy: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  radius: ScalarValue
  color: Color
  pos: Position
}

export interface EllipseNode {
  kind: 'ellipse'
  cx: ScalarValue
  cy: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  rx: ScalarValue
  ry: ScalarValue
  color: Color
  pos: Position
}

export interface OutlineEllipseNode {
  kind: 'oellipse'
  cx: ScalarValue
  cy: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  rx: ScalarValue
  ry: ScalarValue
  color: Color
  pos: Position
}

export type DitherMode = 'checker' | 'bayer' | 'noise'

export interface DitherNode {
  kind: 'dither'
  mode: DitherMode
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  boxName?: string
  boxPoint?: BoxPointSelector
  width: ScalarValue
  height: ScalarValue
  colorA: Color
  colorB: Color
  seed: ScalarValue
  pos: Position
}

export type DrawNode = PixelNode | RectNode | LineNode | OutlineLineNode | CircleNode | ArcNode | PolygonNode | FillNode
  | OutlineRectNode | OutlineCircleNode | OutlinePolygonNode
  | GlowNode | EllipseNode | OutlineEllipseNode | DitherNode | TextNode

export type ASTNode =
  | CanvasNode
  | PaletteNode
  | IncludeNode
  | PixelNode
  | RectNode
  | LineNode
  | OutlineLineNode
  | CircleNode
  | ArcNode
  | MirrorNode
  | GroupNode
  | StampNode
  | RepeatNode
  | PolygonNode
  | FillNode
  | FrameNode
  | LetNode
  | ConstNode
  | LetPairNode
  | LetPointNode
  | DefPointNode
  | AnchorNode
  | BoxNode
  | BitmapNode
  | FontNode
  | ColorNode
  | CursorNode
  | TileNode
  | TilesetNode
  | TilemapNode
  | MapNode
  | TextNode
  | LayerNode
  | ClearNode
  | PushNode
  | PopNode
  | OutlineRectNode
  | OutlineCircleNode
  | OutlinePolygonNode
  | ScatterNode
  | EmitNode
  | GlowNode
  | EllipseNode
  | OutlineEllipseNode
  | DitherNode

export interface Program {
  statements: ASTNode[]
}

export type ParseErrorCode =
  | 'P001' // unknown command
  | 'P002' // unsupported coordinate mode for command
  | 'P003' // expected token/value was missing
  | 'P004' // invalid mirror axis
  | 'P005' // disallowed command inside frame
  | 'P006' // unknown expression intrinsic

export interface ParseError {
  code: ParseErrorCode
  message: string
  line: number
  column: number
}
