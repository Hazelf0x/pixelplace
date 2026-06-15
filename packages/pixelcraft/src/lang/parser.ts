import { Token, TokenType, tokenize } from './lexer'
import {
  Program, ASTNode, CanvasNode, PaletteNode, IncludeNode, PixelNode, RectNode,
  LineNode, CircleNode, ArcNode, Color, ParseError, ParseErrorCode, MirrorNode, MirrorAxis,
  GroupNode, StampNode, RepeatNode, PolygonNode, FillNode, FrameNode, Point,
  PaletteEntry, AnchorNode, BitmapNode, FontNode, FontGlyphNode, ColorNode, CursorNode, TileNode, TilesetNode, TilemapNode, MapNode,
  OutlineLineNode, OutlineRectNode, OutlineCircleNode, OutlinePolygonNode, LayerNode, ClearNode, PushNode, PopNode,
  ConstNode, DefPointNode,
  Expr, ScalarValue, LetNode, LetPointNode, LetPairNode, ScatterNode, EmitNode, GlowNode, EllipseNode, OutlineEllipseNode, DitherNode, SourceSpan, TextNode, TextAlign, BoxNode, BoxPointSelector
} from './ast'
import { CoordinateMode, isExpressionIntrinsic, isReservedWord, isStatementCommand, StatementCommand, supportsCoordinateMode } from './command-registry'
import { getExpressionIntrinsicArity } from './expression-intrinsics'
import { isValidHexColorLiteral } from './hex-color'
import { validateVersionPragma } from './language-version'
import { listPalettePresetNames, lookupPalettePreset } from './palette-presets'
import { MAX_CANVAS_DIMENSION, MIN_CANVAS_DIMENSION, clampCanvasDimension } from '../canvas-limits'

const MAX_BITMAP_DIMENSION = MAX_CANVAS_DIMENSION
const MIN_FRAME_DURATION = 1
const MAX_FRAME_DURATION = 600
const ALLOWED_LET_COMMAND_NAMES = new Set(['frame'])
type ParsedStatement = ASTNode | ASTNode[] | null

interface ParsedCoordinate {
  x: ScalarValue
  y: ScalarValue
  isCenter: boolean
  isRelativeX: boolean
  isRelativeY: boolean
  anchorName?: string
  anchorPos?: { line: number; column: number }
  boxName?: string
  boxPoint?: BoxPointSelector
  boxPos?: { line: number; column: number }
}

interface TimelineEachClause {
  kind: 'each'
  body: ASTNode[]
  pos: { line: number; column: number }
}

interface TimelineRangeClause {
  kind: 'range'
  start: number
  end: number
  body: ASTNode[]
  pos: { line: number; column: number }
}

interface TimelineAtClause {
  kind: 'at'
  frames: number[]
  body: ASTNode[]
  pos: { line: number; column: number }
}

interface TimelineEveryClause {
  kind: 'every'
  interval: number
  offset: number
  body: ASTNode[]
  pos: { line: number; column: number }
}

type TimelineClause = TimelineEachClause | TimelineRangeClause | TimelineAtClause | TimelineEveryClause

export class Parser {
  private tokens: Token[] = []
  private pos = 0
  private errors: ParseError[] = []
  private blockDepth = 0
  private readonly statementParsers: Record<StatementCommand, () => ASTNode | ASTNode[]> = {
    canvas: () => this.parseCanvas(),
    include: () => this.parseInclude(),
    pal: () => this.parsePalette(),
    px: () => this.parsePixel(),
    rect: () => this.parseRect(),
    line: () => this.parseLine(),
    oline: () => this.parseOutlineLine(),
    circ: () => this.parseCircle(),
    arc: () => this.parseArc(),
    mirror: () => this.parseMirror(),
    group: () => this.parseGroup(),
    stamp: () => this.parseStamp(),
    repeat: () => this.parseRepeat(),
    poly: () => this.parsePolygon(),
    fill: () => this.parseFill(),
    frame: () => this.parseFrame(),
    frames: () => this.parseFrames(),
    timeline: () => this.parseTimeline(),
    let: () => this.parseLet(),
    const: () => this.parseConst(),
    letpair: () => this.parseLetPair(),
    letvec: () => this.parseLetVec(),
    letsz: () => this.parseLetSize(),
    defpt: () => this.parseDefPoint(),
    letpt: () => this.parseLetPoint(),
    anchor: () => this.parseAnchor(),
    box: () => this.parseBox(),
    bitmap: () => this.parseBitmap(),
    font: () => this.parseFont(),
    color: () => this.parseColorCommand(),
    clear: () => this.parseClear(),
    cursor: () => this.parseCursor(),
    tile: () => this.parseTile(),
    tileset: () => this.parseTileset(),
    tilemap: () => this.parseTilemap(),
    map: () => this.parseMap(),
    text: () => this.parseText(),
    layer: () => this.parseLayer(),
    with: () => this.parseWith(),
    push: () => this.parsePush(),
    pop: () => this.parsePop(),
    orect: () => this.parseOutlineRect(),
    ocirc: () => this.parseOutlineCircle(),
    opoly: () => this.parseOutlinePolygon(),
    scatter: () => this.parseScatter(),
    emit: () => this.parseEmit(),
    glow: () => this.parseGlow(),
    ellipse: () => this.parseEllipse(),
    oellipse: () => this.parseOutlineEllipse(),
    dither: () => this.parseDither()
  }

  parse(input: string): { program: Program; errors: ParseError[] } {
    this.tokens = tokenize(input)
    this.pos = 0
    this.errors = []
    this.blockDepth = 0

    const statements: ASTNode[] = []

    while (!this.isAtEnd()) {
      this.skipNewlines()
      if (this.isAtEnd()) break

      try {
        const parsed = this.parseStatement()
        this.appendParsedStatement(statements, parsed)
      } catch (e) {
        // Skip to next line on error
        this.skipToNextLine()
      }
    }

    return { program: { statements }, errors: this.errors }
  }

  private parseStatement(): ParsedStatement {
    const token = this.peek()

    if (token.type === 'KEYWORD') {
      if (token.value === 'version') {
        return this.parseVersionPragma()
      }
      if (isStatementCommand(token.value)) {
        return this.statementParsers[token.value]()
      }

      this.addError(`Unknown command: ${token.value}`, token, 'P001')
      this.advance()
      return null
    }

    // Skip unknown tokens
    this.advance()
    return null
  }

  private appendParsedStatement(target: ASTNode[], parsed: ParsedStatement): void {
    if (!parsed) return
    if (Array.isArray(parsed)) {
      target.push(...parsed)
      return
    }
    target.push(parsed)
  }

  private parseCanvas(): CanvasNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'canvas'

    const dim = this.expect('DIMENSION', 'Expected dimension like 16x16')
    const [rawWidth, rawHeight] = dim.value.split('x').map(Number)
    const width = clampCanvasDimension(rawWidth)
    const height = clampCanvasDimension(rawHeight)

    if (
      rawWidth < MIN_CANVAS_DIMENSION ||
      rawHeight < MIN_CANVAS_DIMENSION ||
      rawWidth > MAX_CANVAS_DIMENSION ||
      rawHeight > MAX_CANVAS_DIMENSION
    ) {
      this.addError(
        `Canvas size must be ${MIN_CANVAS_DIMENSION}..${MAX_CANVAS_DIMENSION} per side (got ${rawWidth}x${rawHeight})`,
        dim
      )
    }

    return { kind: 'canvas', width, height, pos }
  }

  private parseInclude(): IncludeNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'include'

    const pathToken = this.expect('STRING', 'Expected quoted include path like "lib/common.pc"')
    return {
      kind: 'include',
      path: pathToken.value,
      pos
    }
  }

  private parseVersionPragma(): ASTNode[] {
    const versionToken = this.peek()
    this.advance() // consume 'version'

    if (this.blockDepth > 0) {
      this.addError('"version" is only allowed as a top-level statement.', versionToken)
      this.skipToNextLine()
      return []
    }

    if (!this.check('NUMBER') && !this.check('STRING')) {
      this.addError('Expected version after "version" (e.g. 0.1 or "0.1.x")', this.peek())
      this.skipToNextLine()
      return []
    }

    const valueToken = this.advance()
    const validation = validateVersionPragma(valueToken.value)
    if (!validation.ok) {
      this.addError(validation.message, valueToken)
    }

    if (!this.check('NEWLINE') && !this.check('EOF')) {
      this.addError('Unexpected token after version pragma. Expected end of line.', this.peek())
      this.skipToNextLine()
    }

    return []
  }

  private parsePalette(): PaletteNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'pal'
    const append = this.check('PLUS')
    if (append) {
      this.advance() // consume optional '+' (supports pal+ and pal + ...)
    }

    const colors: PaletteEntry[] = []

    while (!this.isAtEnd() && !this.check('NEWLINE') && !this.check('EOF')) {
      if (this.check('HEX_COLOR')) {
        // Unnamed color: #ff0044
        const token = this.advance()
        if (!isValidHexColorLiteral(token.value)) {
          this.addError(
            `Invalid hex color "${token.value}". Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`,
            token
          )
        }
        const sourceSpan = this.tokenToSourceSpan(token)
        colors.push({ hex: token.value, sourceSpan, hexSpan: sourceSpan })
      } else if (this.check('NAMED_COLOR')) {
        const token = this.advance()
        const [name, hexPart] = token.value.split('=')
        const sourceSpan = this.tokenToSourceSpan(token)
        const hexStartOffset = name.length + 1
        // Check for gradient: name=#hex..#hex
        if (hexPart.includes('..')) {
          const [hex, hexEnd] = hexPart.split('..')
          if (!isValidHexColorLiteral(hex)) {
            this.addError(
              `Invalid hex color "${hex}" in gradient start. Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`,
              token
            )
          }
          if (!isValidHexColorLiteral(hexEnd)) {
            this.addError(
              `Invalid hex color "${hexEnd}" in gradient end. Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`,
              token
            )
          }
          const hexSpan = this.spanFromTokenOffset(token, hexStartOffset, hex.length)
          const hexEndSpan = this.spanFromTokenOffset(token, hexStartOffset + hex.length + 2, hexEnd.length)
          // Parse optional "steps N"
          let steps = 2
          let stepsSpan: SourceSpan | undefined
          if (this.check('KEYWORD') && this.peek().value === 'steps') {
            this.advance()
            if (this.check('NUMBER')) {
              const stepsToken = this.advance()
              steps = Math.max(2, Math.floor(parseFloat(stepsToken.value)))
              stepsSpan = this.tokenToSourceSpan(stepsToken)
            } else {
              this.addError('Expected number after steps', this.peek())
            }
          }
          colors.push({ name, hex, hexEnd, steps, sourceSpan, hexSpan, hexEndSpan, stepsSpan })
        } else {
          if (!isValidHexColorLiteral(hexPart)) {
            this.addError(
              `Invalid hex color "${hexPart}". Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`,
              token
            )
          }
          const hexSpan = this.spanFromTokenOffset(token, hexStartOffset, hexPart.length)
          colors.push({ name, hex: hexPart, sourceSpan, hexSpan })
        }
      } else if (this.check('SYMBOL')) {
        const token = this.advance()
        const presetRef = token.value.startsWith(':') ? token.value.slice(1) : token.value
        const presetColors = lookupPalettePreset(presetRef)
        if (!presetColors) {
          const available = listPalettePresetNames().map((name) => `:${name}`).join(', ')
          this.addError(
            `Unknown palette preset "${token.value}". Available presets: ${available}.`,
            token
          )
          continue
        }

        const sourceSpan = this.tokenToSourceSpan(token)
        for (let i = 0; i < presetColors.length; i++) {
          colors.push({
            hex: presetColors[i],
            presetName: presetRef.toLowerCase(),
            presetColorIndex: i,
            sourceSpan
          })
        }
      } else {
        break
      }
    }

    return { kind: 'palette', append, colors, pos }
  }

  private parseCoordinate(
    errorMessage = 'Expected coordinate like 8,8, "center", anchor name, or expression pair',
    options?: { allowAnchorOffset?: boolean }
  ): ParsedCoordinate {
    return this.toParsedCoordinate(this.parsePoint(errorMessage, options?.allowAnchorOffset ?? true))
  }

  private toParsedCoordinate(point: Point): ParsedCoordinate {
    return {
      x: point.x,
      y: point.y,
      isCenter: point.isCenter,
      isRelativeX: point.isRelativeX,
      isRelativeY: point.isRelativeY,
      anchorName: point.anchorName,
      anchorPos: point.anchorPos,
      boxName: point.boxName,
      boxPoint: point.boxPoint,
      boxPos: point.boxPos
    }
  }

  private getCoordinateModes(coord: ParsedCoordinate): CoordinateMode[] {
    if (coord.isCenter) return ['center']
    if (coord.anchorName || coord.boxName) return ['anchor']
    if (coord.isRelativeX || coord.isRelativeY) return ['relative']
    return ['absolute']
  }

  private validateCoordinateModes(command: StatementCommand, coord: ParsedCoordinate, token: Token): void {
    for (const mode of this.getCoordinateModes(coord)) {
      if (supportsCoordinateMode(command, mode)) continue
      this.addError(`"${command}" does not support ${mode} coordinates`, token, 'P002')
      throw new Error(`"${command}" does not support ${mode} coordinates`)
    }
  }

  private parseCoordinateForCommand(
    command: StatementCommand,
    errorMessage = 'Expected coordinate like 8,8, "center", anchor name, or expression pair',
    options?: { allowAnchorOffset?: boolean }
  ): ParsedCoordinate {
    const token = this.peek()
    const coord = this.parseCoordinate(errorMessage, options)
    this.validateCoordinateModes(command, coord, token)
    return coord
  }

  private parsePointForCommand(
    command: StatementCommand,
    errorMessage = 'Expected coordinate like 8,8, "center", anchor name, or expression pair'
  ): Point {
    const token = this.peek()
    const point = this.parsePoint(errorMessage)
    this.validateCoordinateModes(command, this.toParsedCoordinate(point), token)
    return point
  }

  private tokenToSourceSpan(token: Token): SourceSpan {
    return {
      start: { line: token.line, column: token.column },
      end: { line: token.line, column: token.column + token.value.length }
    }
  }

  private spanFromTokenOffset(token: Token, offset: number, length: number): SourceSpan {
    return {
      start: { line: token.line, column: token.column + offset },
      end: { line: token.line, column: token.column + offset + length }
    }
  }

  // expectColorAfter: if true, a trailing keyword before NEWLINE is likely a color name
  // Set to false for commands like 'stamp' that don't take a color
  private parseCoordinates(expectColorAfter: boolean = true, command?: StatementCommand): Point[] {
    const coords: Point[] = []

    while (!this.isAtEnd() && !this.check('NEWLINE') && !this.check('EOF')) {
      const startPos = this.pos
      const token = this.peek()
      const point = this.tryParsePointForList(expectColorAfter)
      if (!point) {
        this.pos = startPos
        break
      }
      if (command) {
        this.validateCoordinateModes(command, this.toParsedCoordinate(point), token)
      }
      coords.push(point)
    }

    return coords
  }

  private parseCoordValue(value: string): Point {
    // Parse coordinate value like "8,8" or "+2,+3" or "-1,0"
    const [xPart, yPart] = value.split(',')

    const isRelativeX = xPart.startsWith('+') || xPart.startsWith('-')
    const isRelativeY = yPart.startsWith('+') || yPart.startsWith('-')

    const x = parseInt(xPart, 10)
    const y = parseInt(yPart, 10)

    return { x, y, isCenter: false, isRelativeX, isRelativeY }
  }

  private parseBoxPointSelector(): BoxPointSelector {
    const selectorToken = this.expect('KEYWORD', 'Expected box point selector like center, topRight, or bottom')
    const selector = selectorToken.value
    switch (selector) {
      case 'center':
      case 'top':
      case 'bottom':
      case 'left':
      case 'right':
      case 'topLeft':
      case 'topRight':
      case 'bottomLeft':
      case 'bottomRight':
        return selector
      default:
        this.addError(`Unknown box point selector "${selector}". Use center, top, bottom, left, right, topLeft, topRight, bottomLeft, or bottomRight.`, selectorToken)
        throw new Error('Unknown box point selector')
    }
  }

  private tryParsePointOffset(): Point | null {
    const startPos = this.pos

    if (this.check('COORD')) {
      const coordToken = this.advance()
      const parsed = this.parseCoordValue(coordToken.value)
      return {
        x: parsed.x,
        y: parsed.y,
        isCenter: false,
        isRelativeX: false,
        isRelativeY: false
      }
    }

    const exprCoord = this.tryParseExpressionCoordinate()
    if (!exprCoord) {
      this.pos = startPos
      return null
    }

    if (exprCoord.isCenter || exprCoord.anchorName || exprCoord.boxName) {
      this.pos = startPos
      return null
    }

    return {
      x: exprCoord.x,
      y: exprCoord.y,
      isCenter: false,
      isRelativeX: false,
      isRelativeY: false
    }
  }

  private parseBoxReferencePoint(): Point {
    this.advance() // consume 'box'
    if (!(this.check('KEYWORD') && !isReservedWord(this.peek().value))) {
      this.addError('Expected box name after box', this.peek())
      throw new Error('Expected box name after box')
    }

    const nameToken = this.advance()
    const boxName = nameToken.value
    const boxPos = { line: nameToken.line, column: nameToken.column }
    const boxPoint = this.parseBoxPointSelector()
    const offset = this.tryParsePointOffset()

    return {
      x: offset ? offset.x : 0,
      y: offset ? offset.y : 0,
      isCenter: false,
      isRelativeX: false,
      isRelativeY: false,
      boxName,
      boxPoint,
      boxPos
    }
  }

  private parsePoint(
    errorMessage = 'Expected coordinate like 8,8, "center", anchor name, or expression pair',
    allowAnchorOffset = true
  ): Point {
    if (this.check('KEYWORD') && this.peek().value === 'center') {
      this.advance()
      return { x: 0, y: 0, isCenter: true, isRelativeX: false, isRelativeY: false }
    }

    if (this.check('KEYWORD') && this.peek().value === 'box') {
      return this.parseBoxReferencePoint()
    }

    if (this.check('KEYWORD') && !isReservedWord(this.peek().value)) {
      const anchorToken = this.advance()
      const anchorName = anchorToken.value
      const anchorPos = { line: anchorToken.line, column: anchorToken.column }
      if (allowAnchorOffset) {
        const offset = this.tryParsePointOffset()
        if (offset) {
          return {
            x: offset.x,
            y: offset.y,
            isCenter: false,
            isRelativeX: false,
            isRelativeY: false,
            anchorName,
            anchorPos
          }
        }
      }
      return { x: 0, y: 0, isCenter: false, isRelativeX: false, isRelativeY: false, anchorName, anchorPos }
    }

    if (this.check('COORD')) {
      const coord = this.advance()
      return this.parseCoordValue(coord.value)
    }

    const exprCoord = this.tryParseExpressionCoordinate()
    if (exprCoord) {
      return {
        x: exprCoord.x,
        y: exprCoord.y,
        isCenter: exprCoord.isCenter,
        isRelativeX: exprCoord.isRelativeX,
        isRelativeY: exprCoord.isRelativeY,
        anchorName: exprCoord.anchorName,
        anchorPos: exprCoord.anchorPos,
        boxName: exprCoord.boxName,
        boxPoint: exprCoord.boxPoint,
        boxPos: exprCoord.boxPos
      }
    }

    this.addError(errorMessage, this.peek(), 'P003')
    throw new Error(errorMessage)
  }

  private parsePixel(): PixelNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'px'

    const points = this.parseCoordinates(true, 'px')

    if (points.length === 0) {
      this.addError('Expected at least one coordinate', this.peek())
      points.push({ x: 0, y: 0, isCenter: false, isRelativeX: false, isRelativeY: false })
    }

    const color = this.parseColor()

    return { kind: 'pixel', points, color, pos }
  }

  private parseRect(): RectNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'rect'

    const coord = this.parseCoordinateForCommand(
      'rect',
      'Expected rectangle position like 8,8, "center", or anchor name'
    )
    const { width, height } = this.parseSizePair()
    const color = this.parseColor()
    return {
      kind: 'rect',
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      width,
      height,
      color,
      pos
    }
  }

  private parseLine(): LineNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'line'

    const start = this.parseCoordinateForCommand(
      'line',
      'Expected start coordinate for line',
      { allowAnchorOffset: false }
    )
    const end = this.parseCoordinateForCommand(
      'line',
      'Expected end coordinate for line',
      { allowAnchorOffset: false }
    )

    const color = this.parseColor()

    return {
      kind: 'line',
      x1: start.x, y1: start.y, isCenter1: start.isCenter, isRelativeX1: start.isRelativeX, isRelativeY1: start.isRelativeY, anchorName1: start.anchorName, boxName1: start.boxName, boxPoint1: start.boxPoint,
      x2: end.x, y2: end.y, isCenter2: end.isCenter, isRelativeX2: end.isRelativeX, isRelativeY2: end.isRelativeY, anchorName2: end.anchorName, boxName2: end.boxName, boxPoint2: end.boxPoint,
      color, pos
    }
  }

  private parseOutlineLine(): OutlineLineNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'oline'

    const start = this.parseCoordinateForCommand(
      'oline',
      'Expected start coordinate for oline',
      { allowAnchorOffset: false }
    )
    const end = this.parseCoordinateForCommand(
      'oline',
      'Expected end coordinate for oline',
      { allowAnchorOffset: false }
    )

    const color = this.parseColor()

    return {
      kind: 'oline',
      x1: start.x, y1: start.y, isCenter1: start.isCenter, isRelativeX1: start.isRelativeX, isRelativeY1: start.isRelativeY, anchorName1: start.anchorName, boxName1: start.boxName, boxPoint1: start.boxPoint,
      x2: end.x, y2: end.y, isCenter2: end.isCenter, isRelativeX2: end.isRelativeX, isRelativeY2: end.isRelativeY, anchorName2: end.anchorName, boxName2: end.boxName, boxPoint2: end.boxPoint,
      color, pos
    }
  }

  private parseCircle(): CircleNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'circ'

    const coord = this.parseCoordinateForCommand(
      'circ',
      'Expected circle position like 8,8, "center", or anchor name'
    )

    // Expect radius - could be 'r4' format or just a number
    let radius: ScalarValue = 4
    if (this.check('KEYWORD') && this.peek().value.startsWith('r')) {
      const rToken = this.advance()
      const compactRadius = rToken.value.slice(1)
      if (!/^\d+$/.test(compactRadius)) {
        this.addError(
          `Invalid radius token "${rToken.value}". Use rN or a numeric expression (for variables, use $name like $r).`,
          rToken
        )
        throw new Error('Invalid radius token')
      }
      radius = Number(compactRadius)
    } else if (this.isExpressionStart(this.peek())) {
      radius = this.parseScalarExpression()
    }

    const color = this.parseColor()

    return {
      kind: 'circle',
      cx: coord.x,
      cy: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      radius,
      color,
      pos
    }
  }

  private parseArc(): ArcNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'arc'

    const coord = this.parseCoordinateForCommand(
      'arc',
      'Expected arc position like 8,8, "center", or anchor name'
    )

    let radius: ScalarValue
    if (this.check('KEYWORD') && this.peek().value.startsWith('r')) {
      const rToken = this.advance()
      const compactRadius = rToken.value.slice(1)
      if (!/^\d+$/.test(compactRadius)) {
        this.addError(
          `Invalid radius token "${rToken.value}". Use rN or a numeric expression (for variables, use $name like $r).`,
          rToken
        )
        throw new Error('Invalid radius token')
      }
      radius = Number(compactRadius)
    } else {
      radius = this.parseRequiredScalar('Expected radius for arc')
    }

    const startAngle = this.parseRequiredScalar('Expected start angle for arc')
    const endAngle = this.parseRequiredScalar('Expected end angle for arc')
    const color = this.parseColor()

    return {
      kind: 'arc',
      cx: coord.x,
      cy: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      radius,
      startAngle,
      endAngle,
      color,
      pos
    }
  }

  private parseMirror(): MirrorNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'mirror'

    let axis: MirrorAxis = 'x'

    if (this.check('SYMBOL')) {
      const token = this.advance()
      const sym = token.value
      if (sym === ':x') axis = 'x'
      else if (sym === ':y') axis = 'y'
      else if (sym === ':xy') axis = 'xy'
      else if (sym === ':off') axis = 'off'
      else {
        this.addError('Invalid mirror axis. Use :x, :y, :xy, or :off', token, 'P004')
        throw new Error('Invalid mirror axis')
      }
    } else if (this.check('KEYWORD') && this.peek().value === 'off') {
      this.advance()
      axis = 'off'
    } else if (this.check('KEYWORD')) {
      const token = this.peek()
      this.addError('Invalid mirror axis. Use :x, :y, :xy, or off', token, 'P004')
      throw new Error('Invalid mirror axis')
    }

    return { kind: 'mirror', axis, pos }
  }

  private parseGroup(): GroupNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'group'

    const nameToken = this.expect('STRING', 'Expected group name like "eye"')
    const name = nameToken.value

    let pivot = this.parseOptionalStampPivotClause('group')

    // Expect opening brace
    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after group name')

    const body = this.parseBlock()

    return { kind: 'group', name, pivot, body, pos }
  }

  private parseStamp(): StampNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'stamp'

    const nameToken = this.expect('STRING', 'Expected group name like "eye"')
    const name = nameToken.value

    // Skip optional 'at' keyword
    if (this.check('KEYWORD') && this.peek().value === 'at') {
      this.advance()
    }

    // stamp doesn't have a color, so don't expect one after coordinates
    const points = this.parseCoordinates(false, 'stamp')

    if (points.length === 0) {
      this.addError('Expected at least one coordinate', this.peek())
      points.push({ x: 0, y: 0, isCenter: false, isRelativeX: false, isRelativeY: false })
    }

    // Parse optional stamp modifiers (opacity + transform flags) in any order.
    let opacity: ScalarValue | undefined
    let centerOnTarget = false
    let useTargetPivot = false
    let flipX = false
    let flipY = false
    let rotation: 0 | 90 | 180 | 270 = 0

    while (!this.isAtEnd() && !this.check('NEWLINE') && !this.check('EOF') && !this.check('RBRACE')) {
      if (this.check('KEYWORD') && this.peek().value === 'opacity') {
        this.advance()
        opacity = this.parseRequiredScalar('Expected opacity value after opacity')
        continue
      }

      if (this.check('SYMBOL')) {
        const flagToken = this.peek()
        const transformFlags = this.parseTransformFlags({
          commandName: 'stamp',
          allowCenterOnTarget: true,
          allowTargetPivot: true
        })
        if (transformFlags.centerOnTarget && transformFlags.useTargetPivot) {
          this.addError('"stamp" cannot combine :center and :pivot', flagToken)
        }
        if (transformFlags.centerOnTarget && useTargetPivot) {
          this.addError('"stamp" cannot combine :center and :pivot', flagToken)
        }
        if (transformFlags.useTargetPivot && centerOnTarget) {
          this.addError('"stamp" cannot combine :center and :pivot', flagToken)
        }
        centerOnTarget = centerOnTarget || transformFlags.centerOnTarget
        useTargetPivot = useTargetPivot || transformFlags.useTargetPivot
        flipX = flipX || transformFlags.flipX
        flipY = flipY || transformFlags.flipY
        if (transformFlags.rotation !== 0) {
          rotation = transformFlags.rotation
        }
        continue
      }

      break
    }

    return { kind: 'stamp', name, points, opacity, centerOnTarget, useTargetPivot, flipX, flipY, rotation, pos }
  }

  private parseRepeat(): RepeatNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'repeat'

    const count = this.parseRequiredScalar('Expected repeat count')

    let dx: ScalarValue = 0
    let dy: ScalarValue = 0
    let hasLegacyOffsets = false
    let hasStepOffset = false

    // Parse optional dx N / dy N (legacy) or step WxH (canonical).
    while (this.check('KEYWORD')) {
      const kw = this.peek().value
      if (kw === 'step') {
        if (hasLegacyOffsets) {
          this.addError('Cannot combine repeat "step" with legacy "dx"/"dy" offsets', this.peek())
          throw new Error('Cannot combine repeat step with dx/dy')
        }
        if (hasStepOffset) {
          this.addError('Repeat step can only be specified once', this.peek())
          throw new Error('Repeat step duplicate')
        }
        this.advance()
        const step = this.parseSizePair('Expected repeat step pair like 2x1 or expression x expression')
        dx = step.width
        dy = step.height
        hasStepOffset = true
      } else if (kw === 'dx') {
        if (hasStepOffset) {
          this.addError('Cannot combine repeat "step" with legacy "dx"/"dy" offsets', this.peek())
          throw new Error('Cannot combine repeat step with dx/dy')
        }
        this.advance()
        dx = this.parseRequiredScalar('Expected expression after dx')
        hasLegacyOffsets = true
      } else if (kw === 'dy') {
        if (hasStepOffset) {
          this.addError('Cannot combine repeat "step" with legacy "dx"/"dy" offsets', this.peek())
          throw new Error('Cannot combine repeat step with dx/dy')
        }
        this.advance()
        dy = this.parseRequiredScalar('Expected expression after dy')
        hasLegacyOffsets = true
      } else {
        break
      }
    }

    // Expect opening brace
    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after repeat')

    const body = this.parseBlock()
    const offsetSyntax = hasStepOffset ? 'step' : hasLegacyOffsets ? 'legacy' : 'default'

    return { kind: 'repeat', count, dx, dy, offsetSyntax, body, pos }
  }

  private parsePolygon(): PolygonNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'poly'

    const points = this.parseCoordinates(true, 'poly')

    const color = this.parseColor()

    return { kind: 'polygon', points, color, pos }
  }

  private parseFill(): FillNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'fill'

    const points = this.parseCoordinates(true, 'fill')

    if (points.length === 0) {
      this.addError('Expected at least one coordinate', this.peek())
      points.push({ x: 0, y: 0, isCenter: false, isRelativeX: false, isRelativeY: false })
    }

    const color = this.parseColor()

    return { kind: 'fill', points, color, pos }
  }

  private parseFrame(): FrameNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'frame'

    const frameNumber = this.parseUnsignedInteger('Expected frame number', 'Frame number').value
    const duration = this.parseOptionalFrameDuration()

    // Expect opening brace
    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after frame header')

    const body = this.parseBlock()
    this.validateFrameBody(body)

    return { kind: 'frame', frameNumber, duration, body, pos }
  }

  private parseFrames(): FrameNode[] {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'frames'

    const rangeStart = this.parseUnsignedInteger(
      'Expected range start frame number',
      'Frames range start'
    ).value

    this.skipNewlines()
    this.expect('RANGE', 'Expected ".." in frames range (e.g. frames 0..4)')
    this.skipNewlines()
    const rangeEnd = this.parseUnsignedInteger(
      'Expected range end frame number (e.g. frames 0..4)',
      'Frames range end'
    ).value
    const duration = this.parseOptionalFrameDuration()

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after frames header')

    const body = this.parseBlock()
    this.validateFrameBody(body)

    const frames: FrameNode[] = []
    const step = rangeStart <= rangeEnd ? 1 : -1
    for (let frameNumber = rangeStart; step > 0 ? frameNumber <= rangeEnd : frameNumber >= rangeEnd; frameNumber += step) {
      frames.push({ kind: 'frame', frameNumber, duration, body, pos })
    }

    return frames
  }

  private parseTimeline(): FrameNode[] {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'timeline'

    const timelineRange = this.parseAscendingFrameRange(
      'Expected timeline start frame number',
      'Expected timeline end frame number (e.g. timeline 0..7)',
      'Timeline'
    )
    const duration = this.parseOptionalFrameDuration()

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after timeline header')

    const clauses = this.parseTimelineClauses(timelineRange.start)
    if (clauses.length === 0) {
      this.addError('Timeline block should include at least one clause (each, range, or at)', this.peek())
    }

    return this.expandTimelineToFrames(
      timelineRange.start,
      timelineRange.end,
      duration,
      clauses,
      pos
    )
  }

  private parseTimelineClauses(timelineStart: number): TimelineClause[] {
    const clauses: TimelineClause[] = []
    this.skipNewlines()

    while (!this.isAtEnd() && !this.check('RBRACE')) {
      this.skipNewlines()
      if (this.check('RBRACE')) break

      if (!(this.check('KEYWORD'))) {
        this.addError('Expected timeline clause: each, range, at, or every', this.peek())
        this.skipToNextLine()
        continue
      }

      const kw = this.peek().value
      try {
        if (kw === 'each') {
          clauses.push(this.parseTimelineEachClause())
        } else if (kw === 'range') {
          clauses.push(this.parseTimelineRangeClause())
        } else if (kw === 'at') {
          clauses.push(this.parseTimelineAtClause(timelineStart))
        } else if (kw === 'every') {
          clauses.push(this.parseTimelineEveryClause())
        } else {
          this.addError('Expected timeline clause: each, range, at, or every', this.peek())
          this.skipToNextLine()
        }
      } catch {
        this.skipToNextLine()
      }

      this.skipNewlines()
    }

    if (this.check('RBRACE')) {
      this.advance()
    }

    return clauses
  }

  private parseTimelineEachClause(): TimelineEachClause {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'each'
    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after each in timeline')
    const body = this.parseBlock()
    this.validateFrameBody(body)
    return { kind: 'each', body, pos }
  }

  private parseTimelineRangeClause(): TimelineRangeClause {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'range'
    const range = this.parseAscendingFrameRange(
      'Expected range start frame number in timeline clause',
      'Expected range end frame number in timeline clause (e.g. range 0..3)',
      'Timeline range'
    )
    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after timeline range clause')
    const body = this.parseBlock()
    this.validateFrameBody(body)
    return { kind: 'range', start: range.start, end: range.end, body, pos }
  }

  private parseTimelineAtClause(timelineStart: number): TimelineAtClause {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'at'

    const frames: number[] = []
    let expectFrame = true

    while (!this.isAtEnd()) {
      this.skipNewlines()

      if (this.check('LBRACE')) {
        break
      }

      if (this.check('COMMA')) {
        this.advance()
        expectFrame = true
        continue
      }

      if (this.check('NUMBER')) {
        const frameToken = this.advance()
        frames.push(this.parseIntegerTokenValue(frameToken, 'Timeline "at" frame number'))
        expectFrame = false
        continue
      }

      if (this.check('COORD')) {
        const coordToken = this.advance()
        const [startRaw, endRaw] = coordToken.value.split(',')
        const start = Number(startRaw)
        const end = Number(endRaw)
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          this.addError('Expected numeric frame numbers in timeline at clause', coordToken)
        } else {
          frames.push(start, end)
          expectFrame = false
        }
        continue
      }

      break
    }

    if (expectFrame && frames.length > 0) {
      this.addError('Expected frame number after "," in timeline at clause', this.peek())
    }

    if (frames.length === 0) {
      this.addError('Expected at least one frame number in timeline at clause', this.peek())
      frames.push(timelineStart)
    }

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after timeline at clause')
    const body = this.parseBlock()
    this.validateFrameBody(body)

    return { kind: 'at', frames, body, pos }
  }

  private parseTimelineEveryClause(): TimelineEveryClause {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'every'

    const intervalParsed = this.parseSignedInteger(
      'Expected positive frame interval after every in timeline clause',
      'Timeline every interval'
    )
    let interval = intervalParsed.value
    if (interval <= 0) {
      this.addError(`Timeline every interval must be > 0 (got ${interval})`, intervalParsed.token)
      interval = 1
    }

    this.skipNewlines()
    let offset = 0
    if (this.check('KEYWORD') && this.peek().value === 'offset') {
      this.advance() // consume 'offset'
      offset = this.parseSignedInteger(
        'Expected integer frame offset after offset in timeline every clause',
        'Timeline every offset'
      ).value
    }

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after timeline every clause')
    const body = this.parseBlock()
    this.validateFrameBody(body)

    return { kind: 'every', interval, offset, body, pos }
  }

  private parseAscendingFrameRange(
    startError: string,
    endError: string,
    label: string
  ): { start: number; end: number } {
    const startParsed = this.parseUnsignedInteger(startError, `${label} range start`)
    const startToken = startParsed.token
    let start = startParsed.value

    this.skipNewlines()
    this.expect('RANGE', 'Expected ".." between range bounds')
    this.skipNewlines()
    let end = this.parseUnsignedInteger(endError, `${label} range end`).value

    if (start > end) {
      this.addError(`${label} must be ascending (got ${start}..${end})`, startToken)
      const temp = start
      start = end
      end = temp
    }

    return { start, end }
  }

  private expandTimelineToFrames(
    timelineStart: number,
    timelineEnd: number,
    duration: number,
    clauses: TimelineClause[],
    pos: { line: number; column: number }
  ): FrameNode[] {
    const byFrame = new Map<number, ASTNode[]>()
    for (let frameNumber = timelineStart; frameNumber <= timelineEnd; frameNumber++) {
      byFrame.set(frameNumber, [])
    }

    const timelineSpan = timelineEnd - timelineStart
    const timelineDenom = timelineSpan === 0 ? 1 : timelineSpan

    const appendClauseBody = (frameNumber: number, body: ASTNode[], localFrame: number, localT: number): void => {
      const target = byFrame.get(frameNumber)
      if (!target) return
      const timelineFrame = frameNumber - timelineStart
      const timelineT = timelineFrame / timelineDenom
      target.push(...this.buildTimelinePrelude(timelineT, localFrame, localT, pos))
      target.push(...body)
    }

    for (const clause of clauses) {
      if (clause.kind === 'each') {
        for (let frameNumber = timelineStart; frameNumber <= timelineEnd; frameNumber++) {
          const localFrame = frameNumber - timelineStart
          const localT = localFrame / timelineDenom
          appendClauseBody(frameNumber, clause.body, localFrame, localT)
        }
        continue
      }

      if (clause.kind === 'range') {
        const start = Math.max(timelineStart, clause.start)
        const end = Math.min(timelineEnd, clause.end)
        const span = end - start
        const denom = span === 0 ? 1 : span
        for (let frameNumber = start; frameNumber <= end; frameNumber++) {
          const localFrame = frameNumber - start
          const localT = localFrame / denom
          appendClauseBody(frameNumber, clause.body, localFrame, localT)
        }
        continue
      }

      if (clause.kind === 'at') {
        const atFrames = clause.frames.filter((frameNumber) => frameNumber >= timelineStart && frameNumber <= timelineEnd)
        const lastAtIndex = atFrames.length <= 1 ? 1 : atFrames.length - 1
        for (let i = 0; i < atFrames.length; i++) {
          const localFrame = i
          const localT = i / lastAtIndex
          appendClauseBody(atFrames[i], clause.body, localFrame, localT)
        }
        continue
      }

      const cadenceStart = timelineStart + clause.offset
      const cadenceFrames: number[] = []
      for (let frameNumber = timelineStart; frameNumber <= timelineEnd; frameNumber++) {
        const delta = frameNumber - cadenceStart
        if (delta < 0) continue
        if (delta % clause.interval === 0) {
          cadenceFrames.push(frameNumber)
        }
      }
      const lastCadenceIndex = cadenceFrames.length <= 1 ? 1 : cadenceFrames.length - 1
      for (let i = 0; i < cadenceFrames.length; i++) {
        const localFrame = i
        const localT = i / lastCadenceIndex
        appendClauseBody(cadenceFrames[i], clause.body, localFrame, localT)
      }
    }

    const frames: FrameNode[] = []
    for (let frameNumber = timelineStart; frameNumber <= timelineEnd; frameNumber++) {
      frames.push({
        kind: 'frame',
        frameNumber,
        duration,
        body: byFrame.get(frameNumber) ?? [],
        pos
      })
    }

    return frames
  }

  private buildTimelinePrelude(
    t: number,
    localFrame: number,
    localT: number,
    pos: { line: number; column: number }
  ): LetNode[] {
    return [
      {
        kind: 'let',
        name: 't',
        value: { kind: 'literal', value: t },
        pos
      },
      {
        kind: 'let',
        name: 'localFrame',
        value: { kind: 'literal', value: localFrame },
        pos
      },
      {
        kind: 'let',
        name: 'localT',
        value: { kind: 'literal', value: localT },
        pos
      }
    ]
  }

  private parseOptionalFrameDuration(): number {
    let duration = 1

    this.skipNewlines()
    if (this.check('KEYWORD') && this.peek().value === 'duration') {
      this.advance() // consume 'duration'
      const durationToken = this.expect('NUMBER', 'Expected frame duration after "duration"')
      const rawDuration = Number(durationToken.value)
      const clampedDuration = Math.max(
        MIN_FRAME_DURATION,
        Math.min(MAX_FRAME_DURATION, Math.floor(rawDuration))
      )
      duration = clampedDuration

      if (clampedDuration !== rawDuration) {
        this.addError(
          `Frame duration must be ${MIN_FRAME_DURATION}..${MAX_FRAME_DURATION} (got ${rawDuration})`,
          durationToken
        )
      }
    }

    return duration
  }

  private parseLet(): LetNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'let'

    if (!this.check('KEYWORD') && !this.check('VAR')) {
      this.addError('Expected variable name after let (e.g. let x = 1 or let $x = 1)', this.peek())
      throw new Error('Expected variable name after let')
    }
    const nameToken = this.advance()
    const name = nameToken.value
    if (!name) {
      this.addError('Expected variable name after "$" in let declaration', nameToken)
    }
    if (isStatementCommand(name) && !ALLOWED_LET_COMMAND_NAMES.has(name)) {
      this.addError(`Cannot use reserved keyword '${name}' as let name`, nameToken)
    }

    this.expect('EQUAL', 'Expected "=" in let declaration')
    const value = this.parseExpression()

    return { kind: 'let', name, value, pos }
  }

  private parseConst(): ConstNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'const'

    if (!this.check('KEYWORD') && !this.check('VAR')) {
      this.addError('Expected symbol name after const (e.g. const x = 1)', this.peek())
      throw new Error('Expected symbol name after const')
    }
    const nameToken = this.advance()
    const name = nameToken.value
    if (!name) {
      this.addError('Expected symbol name after "$" in const declaration', nameToken)
    }
    if (isReservedWord(name)) {
      this.addError(`Cannot use reserved keyword '${name}' as const name`, nameToken)
    }

    this.expect('EQUAL', 'Expected "=" in const declaration')
    const value = this.parseExpression()

    return { kind: 'const', name, value, pos }
  }

  private parseLetPair(): LetPairNode {
    return this.parsePairAliasDeclaration('letpair')
  }

  private parseLetVec(): LetPairNode {
    return this.parsePairAliasDeclaration('letvec')
  }

  private parseLetSize(): LetPairNode {
    return this.parsePairAliasDeclaration('letsz')
  }

  private parsePairAliasDeclaration(commandName: 'letpair' | 'letvec' | 'letsz'): LetPairNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume pair alias command

    let name: string
    let nameToken: Token
    if (this.check('KEYWORD')) {
      nameToken = this.advance()
      name = nameToken.value
    } else if (this.check('VAR')) {
      nameToken = this.advance()
      name = nameToken.value
      if (!name) {
        this.addError('Expected pair alias name after "$"', nameToken)
      }
    } else {
      this.addError(`Expected pair alias name after ${commandName}`, this.peek())
      throw new Error(`Expected pair alias name after ${commandName}`)
    }

    if (isReservedWord(name)) {
      this.addError(`Cannot use reserved keyword '${name}' as pair alias name`, nameToken)
    }

    this.expect('EQUAL', `Expected "=" in ${commandName} declaration`)
    const size = this.parseSizePair('Expected size pair like 8x4, sizeAlias, or expression x expression')
    const aliasKind = commandName === 'letvec' ? 'vec' : commandName === 'letsz' ? 'size' : 'pair'
    return {
      kind: commandName,
      aliasKind,
      name,
      width: size.width,
      height: size.height,
      pos
    }
  }

  private parseDefPoint(): DefPointNode {
    return this.parsePointSymbolDeclaration('defpt') as DefPointNode
  }

  private parseLetPoint(): LetPointNode {
    return this.parsePointSymbolDeclaration('letpt') as LetPointNode
  }

  private parsePointSymbolDeclaration(kind: 'letpt' | 'defpt'): LetPointNode | DefPointNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume point declaration command

    let name: string
    let nameToken: Token
    if (this.check('KEYWORD')) {
      nameToken = this.advance()
      name = nameToken.value
    } else if (this.check('VAR')) {
      nameToken = this.advance()
      name = nameToken.value
      if (!name) {
        this.addError('Expected point symbol name after "$"', nameToken)
      }
    } else {
      this.addError(`Expected point symbol name after ${kind}`, this.peek())
      throw new Error(`Expected point symbol name after ${kind}`)
    }

    if (isReservedWord(name)) {
      this.addError(`Cannot use reserved keyword '${name}' as point symbol name`, nameToken)
    }

    this.expect('EQUAL', `Expected "=" in ${kind} declaration`)
    const point = this.parsePoint(`Expected coordinate for ${kind} point declaration`)

    if (kind === 'defpt' && (point.isRelativeX || point.isRelativeY)) {
      this.addError(
        'defpt does not support cursor-relative coordinates; use absolute, center, anchor, or anchor offset forms.',
        nameToken
      )
      throw new Error('defpt does not support cursor-relative coordinates')
    }

    if (kind === 'defpt') {
      return { kind: 'defpt', name, point, pos }
    }
    return { kind: 'letpt', name, point, pos }
  }

  private parseAnchor(): AnchorNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'anchor'

    // Expect anchor name (a non-reserved keyword)
    const nameToken = this.expect('KEYWORD', 'Expected anchor name')
    const name = nameToken.value

    if (isReservedWord(name)) {
      this.addError(`Cannot use reserved keyword '${name}' as anchor name`, nameToken)
    }

    // Expect coordinate
    const parsed = this.tryParseExpressionCoordinate()
    if (parsed) {
      return { kind: 'anchor', name, x: parsed.x, y: parsed.y, pos }
    }

    const coord = this.expect('COORD', 'Expected coordinate like 8,4 or expression pair')
    const [x, y] = coord.value.split(',').map(Number)

    return { kind: 'anchor', name, x, y, pos }
  }

  private parseBox(): BoxNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'box'

    const nameToken = this.expect('KEYWORD', 'Expected box name')
    const name = nameToken.value
    if (isReservedWord(name)) {
      this.addError(`Cannot use reserved keyword '${name}' as box name`, nameToken)
    }

    if (this.check('KEYWORD') && this.peek().value === 'in') {
      this.advance() // consume 'in'

      const parentToken = this.expect('KEYWORD', 'Expected parent box name after "in"')
      const parentBoxName = parentToken.value
      if (isReservedWord(parentBoxName)) {
        this.addError(`Cannot use reserved keyword '${parentBoxName}' as box name`, parentToken)
      }

      if (!(this.check('KEYWORD') && this.peek().value === 'dock')) {
        this.addError('Expected "dock" after parent box name', this.peek())
        throw new Error('Expected "dock" after parent box name')
      }
      this.advance() // consume 'dock'

      const boxPoint = this.parseBoxPointSelector()
      const { width, height } = this.parseSizePair('Expected box size like 16x10 or expression x expression')

      let offsetX: ScalarValue = 0
      let offsetY: ScalarValue = 0
      if (this.check('KEYWORD') && this.peek().value === 'offset') {
        this.advance()
        const offset = this.tryParsePointOffset()
        if (!offset) {
          this.addError('Expected offset pair like +2,-1 or expression pair after "offset"', this.peek())
          throw new Error('Expected offset pair after "offset"')
        }
        offsetX = offset.x
        offsetY = offset.y
      }

      return {
        kind: 'box',
        name,
        x: offsetX,
        y: offsetY,
        isCenter: false,
        isRelativeX: false,
        isRelativeY: false,
        boxName: parentBoxName,
        boxPoint,
        dockToBoxPoint: true,
        width,
        height,
        pos
      }
    }

    if (this.check('KEYWORD') && this.peek().value === 'at') {
      this.advance()
    }

    const coord = this.parseCoordinateForCommand(
      'box',
      'Expected box position like 8,8, center, anchor name, or box point'
    )
    const { width, height } = this.parseSizePair('Expected box size like 16x10 or expression x expression')

    return {
      kind: 'box',
      name,
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      width,
      height,
      pos
    }
  }

  private parseBitmap(): BitmapNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'bitmap'

    // Expect bitmap name
    const nameToken = this.expect('STRING', 'Expected bitmap name like "spark"')
    const name = nameToken.value

    let colorMap: Record<string, string> | undefined
    let pivot = this.parseOptionalStampPivotClause('bitmap')

    while (this.check('KEYWORD')) {
      if (this.peek().value === 'map') {
        this.advance() // consume 'map'
        colorMap = {}

        // Parse KEY=NAME pairs until we hit "{" or end of line.
        while (!this.isAtEnd() && !this.check('LBRACE') && !this.check('NEWLINE')) {
          if (!this.check('KEYWORD')) {
            this.addError('Expected map key like B in bitmap map clause', this.peek())
            break
          }

          const keyToken = this.advance()
          const key = keyToken.value

          if (!this.check('EQUAL')) {
            this.addError('Expected "=" after map key in bitmap map clause', this.peek())
            break
          }
          this.advance() // consume '='

          if (!this.check('KEYWORD')) {
            this.addError('Expected color name or "transparent" after = in map clause', this.peek())
            break
          }

          const colorName = this.advance().value
          if (key.length !== 1) {
            this.addError(`Map key must be a single character, got "${key}"`, keyToken)
            continue
          }

          colorMap[key] = colorName
        }
        continue
      }

      if (this.peek().value === 'pivot') {
        if (pivot) {
          this.addError('Bitmap pivot can only be specified once', this.peek())
          this.advance()
          continue
        }
        pivot = this.parseOptionalStampPivotClause('bitmap')
        continue
      }

      break
    }

    // Expect opening brace
    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after bitmap name')

    // Collect string rows until closing brace
    const rows: string[] = []
    const rowSpans: SourceSpan[] = []
    let reportedWidthLimit = false
    let reportedHeightLimit = false
    this.skipNewlines()

    while (!this.isAtEnd() && !this.check('RBRACE')) {
      if (this.check('STRING')) {
        const rowToken = this.advance()
        if (rows.length >= MAX_BITMAP_DIMENSION) {
          if (!reportedHeightLimit) {
            this.addError(
              `Bitmap height exceeds ${MAX_BITMAP_DIMENSION} rows; extra rows are ignored.`,
              rowToken
            )
            reportedHeightLimit = true
          }
          this.skipNewlines()
          continue
        }

        let rowValue = rowToken.value
        if (rowValue.length > MAX_BITMAP_DIMENSION) {
          if (!reportedWidthLimit) {
            this.addError(
              `Bitmap row width exceeds ${MAX_BITMAP_DIMENSION} columns; rows are truncated.`,
              rowToken
            )
            reportedWidthLimit = true
          }
          rowValue = rowValue.slice(0, MAX_BITMAP_DIMENSION)
        }

        rows.push(rowValue)
        rowSpans.push(this.spanFromTokenOffset(rowToken, 1, rowValue.length))
        this.skipNewlines()
        continue
      }

      // Recover from malformed bitmap bodies (e.g. stray tokens) so
      // parsing always makes progress and never stalls.
      this.addError('Expected bitmap row string like "0101" inside bitmap block', this.peek())
      this.advance()
      this.skipNewlines()
    }

    // Consume closing brace
    if (this.check('RBRACE')) {
      this.advance()
    }

    return { kind: 'bitmap', name, pivot, rows, rowSpans, colorMap, pos }
  }

  private parseOptionalStampPivotClause(contextLabel: 'bitmap' | 'group'): { x: ScalarValue; y: ScalarValue } | undefined {
    if (!(this.check('KEYWORD') && this.peek().value === 'pivot')) {
      return undefined
    }

    const pivotToken = this.advance() // consume 'pivot'
    const pivot = this.parseCoordinate('Expected pivot pair like 2,3 or expression pair', { allowAnchorOffset: false })
    if (pivot.isCenter || pivot.anchorName || pivot.isRelativeX || pivot.isRelativeY) {
      this.addError(`"${contextLabel}" pivot must use an absolute pair like 2,3 or an expression pair`, pivotToken)
    }
    return { x: pivot.x, y: pivot.y }
  }

  private parseFont(): FontNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'font'

    const nameToken = this.expect('STRING', 'Expected font name like "ui"')
    const name = nameToken.value

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after font name')

    const glyphs: FontGlyphNode[] = []
    const seenGlyphChars = new Set<string>()
    this.skipNewlines()

    while (!this.isAtEnd() && !this.check('RBRACE')) {
      if (this.check('KEYWORD') && this.peek().value === 'glyph') {
        const glyph = this.parseFontGlyph()
        if (seenGlyphChars.has(glyph.char)) {
          this.addError(`Duplicate glyph "${glyph.char}" in font "${name}"`, { type: 'STRING', value: glyph.char, line: glyph.pos.line, column: glyph.pos.column })
        } else {
          seenGlyphChars.add(glyph.char)
        }
        glyphs.push(glyph)
        this.skipNewlines()
        continue
      }

      this.addError('Expected glyph declaration like glyph "A" advance 6 { ... }', this.peek())
      this.skipToNextLine()
      this.skipNewlines()
    }

    if (this.check('RBRACE')) {
      this.advance()
    }

    if (glyphs.length === 0) {
      this.addError('Font must declare at least one glyph', nameToken)
    }

    return { kind: 'font', name, glyphs, pos }
  }

  private parseFontGlyph(): FontGlyphNode {
    const glyphToken = this.expect('KEYWORD', 'Expected "glyph" declaration')
    const pos = { line: glyphToken.line, column: glyphToken.column }
    const charToken = this.expect('STRING', 'Expected glyph character like "A"')
    let char = charToken.value
    if (char.length !== 1) {
      this.addError(`Glyph character must be exactly one character, got "${char}"`, charToken)
      char = char.length > 0 ? char[0] : '?'
    }

    if (!(this.check('KEYWORD') && this.peek().value === 'advance')) {
      this.addError('Expected "advance" in glyph declaration', this.peek())
      throw new Error('Expected "advance" in glyph declaration')
    }
    this.advance() // consume "advance"
    const advance = this.parseGlyphAdvance()

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after glyph advance')

    const rows: string[] = []
    let reportedWidthLimit = false
    let reportedHeightLimit = false
    this.skipNewlines()

    while (!this.isAtEnd() && !this.check('RBRACE')) {
      if (this.check('STRING')) {
        const rowToken = this.advance()
        if (rows.length >= MAX_BITMAP_DIMENSION) {
          if (!reportedHeightLimit) {
            this.addError(
              `Glyph height exceeds ${MAX_BITMAP_DIMENSION} rows; extra rows are ignored.`,
              rowToken
            )
            reportedHeightLimit = true
          }
          this.skipNewlines()
          continue
        }

        let rowValue = rowToken.value
        if (rowValue.length > MAX_BITMAP_DIMENSION) {
          if (!reportedWidthLimit) {
            this.addError(
              `Glyph row width exceeds ${MAX_BITMAP_DIMENSION} columns; rows are truncated.`,
              rowToken
            )
            reportedWidthLimit = true
          }
          rowValue = rowValue.slice(0, MAX_BITMAP_DIMENSION)
        }

        rows.push(rowValue)
        this.skipNewlines()
        continue
      }

      this.addError('Expected glyph row string like "0110" inside glyph block', this.peek())
      this.advance()
      this.skipNewlines()
    }

    if (this.check('RBRACE')) {
      this.advance()
    }

    if (rows.length === 0) {
      this.addError('Glyph body must include at least one row string', glyphToken)
      rows.push('.')
    }

    return { char, advance, rows, pos }
  }

  private parseGlyphAdvance(): number {
    let sign = 1
    if (this.check('PLUS') || this.check('MINUS')) {
      sign = this.advance().type === 'MINUS' ? -1 : 1
    }

    if (!this.check('NUMBER')) {
      this.addError('Expected numeric glyph advance after "advance"', this.peek())
      throw new Error('Expected numeric glyph advance after "advance"')
    }

    const numberToken = this.advance()
    const raw = sign * Number(numberToken.value)
    if (!Number.isFinite(raw)) {
      this.addError('Glyph advance must be a finite number', numberToken)
      return 1
    }

    const advance = Math.trunc(raw)
    if (advance <= 0) {
      this.addError(`Glyph advance must be greater than 0 (got ${raw})`, numberToken)
      return 1
    }

    return advance
  }

  private parseColorCommand(): ColorNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'color'

    const color = this.parseColor()
    if (color.type === 'current') {
      this.addError('Expected a color after "color"', this.peek())
    }

    return { kind: 'color', color, pos }
  }

  private parseCursor(): CursorNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'cursor'

    const point = this.parsePointForCommand('cursor', 'Expected cursor position like 8,8, +1,+0, "center", or anchor name')

    return { kind: 'cursor', point, pos }
  }

  private parseText(): TextNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'text'

    const valueToken = this.expect('STRING', 'Expected text value like "HELLO"')
    const value = valueToken.value

    if (this.check('KEYWORD') && this.peek().value === 'at') {
      this.advance()
    }

    const coord = this.parseCoordinateForCommand('text', 'Expected text position like 8,8, "center", or anchor name')

    let fontName = ''
    let color: Color = { type: 'current' }
    let hasFont = false
    let hasColor = false
    let align: TextAlign = 'left'
    let tracking: ScalarValue = 0
    let lineHeight: ScalarValue = 0
    let wrap: ScalarValue | undefined

    while (!this.isAtEnd() && !this.check('NEWLINE') && !this.check('EOF') && !this.check('RBRACE')) {
      if (!this.check('KEYWORD')) break
      const kw = this.peek().value

      if (kw === 'font') {
        this.advance()
        const fontToken = this.expect('STRING', 'Expected font name like "ui" after font')
        fontName = fontToken.value
        hasFont = true
        continue
      }

      if (kw === 'color') {
        this.advance()
        color = this.parseColor()
        hasColor = true
        if (color.type === 'current') {
          this.addError('Expected a color after "color"', this.peek())
        }
        continue
      }

      if (kw === 'align') {
        this.advance()
        if (!this.check('KEYWORD')) {
          this.addError('Expected alignment after align (left, center, right)', this.peek())
          throw new Error('Expected alignment after align')
        }
        const alignToken = this.advance()
        if (alignToken.value === 'left' || alignToken.value === 'center' || alignToken.value === 'right') {
          align = alignToken.value
        } else {
          this.addError('Invalid align value. Use left, center, or right.', alignToken)
        }
        continue
      }

      if (kw === 'tracking') {
        this.advance()
        tracking = this.parseRequiredScalar('Expected tracking value after tracking')
        continue
      }

      if (kw === 'lineHeight') {
        this.advance()
        lineHeight = this.parseRequiredScalar('Expected lineHeight value after lineHeight')
        continue
      }

      if (kw === 'wrap') {
        this.advance()
        wrap = this.parseRequiredScalar('Expected wrap width after wrap')
        continue
      }

      break
    }

    if (!hasFont) {
      this.addError('Expected text font clause: font "name"', valueToken)
    }

    if (!hasColor) {
      this.addError('Expected text color clause: color <value>', valueToken)
    }

    return {
      kind: 'text',
      value,
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      fontName,
      color,
      align,
      tracking,
      lineHeight,
      wrap,
      pos
    }
  }

  private parseTile(): TileNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'tile'

    const nameToken = this.expect('STRING', 'Expected bitmap or group name like "grass"')
    const name = nameToken.value

    // Optional 'at'
    if (this.check('KEYWORD') && this.peek().value === 'at') {
      this.advance()
    }

    const coord = this.parseCoordinateForCommand('tile')

    const { width, height } = this.parseSizePair('Expected size like 16x16, 16, expression, or expression x expression')

    let stepX: ScalarValue | undefined
    let stepY: ScalarValue | undefined
    if (this.check('KEYWORD') && this.peek().value === 'step') {
      this.advance()
      const parsedStep = this.parseSizePair('Expected step size like 8x8, 8, expression, or expression x expression')
      stepX = parsedStep.width
      stepY = parsedStep.height
    }

    // Parse optional transform flags (:flipx, :flipy, :rot90, :rot180, :rot270)
    const { flipX, flipY, rotation } = this.parseTransformFlags({
      commandName: 'tile'
    })

    return {
      kind: 'tile',
      name,
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      width,
      height,
      stepX,
      stepY,
      flipX,
      flipY,
      rotation,
      pos
    }
  }

  private parseTileset(): TilesetNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'tileset'

    const nameToken = this.expect('STRING', 'Expected tileset name like "terrain"')
    const name = nameToken.value

    if (!(this.check('KEYWORD') && this.peek().value === 'tileSize')) {
      this.addError('Expected "tileSize" in tileset declaration', this.peek())
      throw new Error('Expected "tileSize" in tileset declaration')
    }
    this.advance() // consume 'tileSize'

    const sizeToken = this.expect('DIMENSION', 'Expected tileSize like 8x8')
    const [rawWidth, rawHeight] = sizeToken.value.split('x').map(Number)
    const tileWidth = Math.max(1, Math.floor(rawWidth))
    const tileHeight = Math.max(1, Math.floor(rawHeight))
    let seed: ScalarValue = 0

    if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
      this.addError(`Tile size must be greater than 0 (got ${sizeToken.value})`, sizeToken)
    }

    while (this.check('KEYWORD')) {
      const kw = this.peek().value
      if (kw === 'seed') {
        this.advance()
        seed = this.parseRequiredScalar('Expected number after tileset seed')
        continue
      }
      break
    }

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after tileset declaration')

    const entries: TilesetNode['entries'] = []
    this.skipNewlines()

    while (!this.isAtEnd() && !this.check('RBRACE')) {
      if (this.check('KEYWORD') && this.peek().value === 'tile') {
        const tileToken = this.advance() // consume 'tile'
        const symbol = this.parseTilesetSymbol()
        const targetToken = this.expect('STRING', 'Expected tile target name like "grass"')
        const target = targetToken.value
        let weight: ScalarValue | undefined

        if (symbol === '.') {
          this.addError('Tileset symbol "." is reserved for empty tilemap cells', targetToken)
        }
        if (target.length === 0) {
          this.addError('Tileset target name cannot be empty', targetToken)
        }

        while (this.check('KEYWORD')) {
          const kw = this.peek().value
          if (kw === 'weight') {
            this.advance()
            weight = this.parseRequiredScalar('Expected number after tile weight')
            continue
          }
          break
        }

        entries.push({
          symbol,
          target,
          weight,
          pos: { line: tileToken.line, column: tileToken.column }
        })
        this.skipNewlines()
        continue
      }

      this.addError('Expected tileset entry like tile "G" "grass"', this.peek())
      this.skipToNextLine()
      this.skipNewlines()
    }

    if (this.check('RBRACE')) {
      this.advance()
    }

    if (entries.length === 0) {
      this.addError('Tileset must include at least one tile entry', nameToken)
    }

    return { kind: 'tileset', name, tileWidth, tileHeight, seed, entries, pos }
  }

  private parseTilesetSymbol(): string {
    if (!(this.check('STRING') || this.check('KEYWORD') || this.check('NUMBER'))) {
      this.addError('Expected tile symbol like "G"', this.peek())
      throw new Error('Expected tile symbol')
    }

    const token = this.advance()
    let symbol = token.value

    if (symbol.length !== 1) {
      this.addError(`Tile symbol must be exactly one character, got "${symbol}"`, token)
      symbol = symbol.length > 0 ? symbol[0] : '?'
    }

    return symbol
  }

  private parseTilemap(): TilemapNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'tilemap'

    const nameToken = this.expect('STRING', 'Expected tilemap name like "field"')
    const name = nameToken.value

    if (!(this.check('KEYWORD') && this.peek().value === 'from')) {
      this.addError('Expected "from" in tilemap declaration', this.peek())
      throw new Error('Expected "from" in tilemap declaration')
    }
    this.advance() // consume 'from'

    const tilesetToken = this.expect('STRING', 'Expected tileset name like "terrain" after from')
    const tilesetName = tilesetToken.value

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after tilemap declaration')

    const rows: string[] = []
    const rowSpans: SourceSpan[] = []
    let expectedWidth: number | null = null
    let reportedWidthLimit = false
    let reportedHeightLimit = false
    this.skipNewlines()

    while (!this.isAtEnd() && !this.check('RBRACE')) {
      if (this.check('STRING')) {
        const rowToken = this.advance()
        if (rows.length >= MAX_BITMAP_DIMENSION) {
          if (!reportedHeightLimit) {
            this.addError(
              `Tilemap height exceeds ${MAX_BITMAP_DIMENSION} rows; extra rows are ignored.`,
              rowToken
            )
            reportedHeightLimit = true
          }
          this.skipNewlines()
          continue
        }

        let rowValue = rowToken.value
        if (rowValue.length > MAX_BITMAP_DIMENSION) {
          if (!reportedWidthLimit) {
            this.addError(
              `Tilemap row width exceeds ${MAX_BITMAP_DIMENSION} columns; rows are truncated.`,
              rowToken
            )
            reportedWidthLimit = true
          }
          rowValue = rowValue.slice(0, MAX_BITMAP_DIMENSION)
        }

        if (expectedWidth === null) {
          expectedWidth = rowValue.length
        } else if (rowValue.length !== expectedWidth) {
          this.addError(
            `Tilemap rows must have equal width (expected ${expectedWidth}, got ${rowValue.length})`,
            rowToken
          )
        }

        rows.push(rowValue)
        rowSpans.push(this.spanFromTokenOffset(rowToken, 1, rowValue.length))
        this.skipNewlines()
        continue
      }

      this.addError('Expected tilemap row string like "GGSS" inside tilemap block', this.peek())
      this.advance()
      this.skipNewlines()
    }

    if (this.check('RBRACE')) {
      this.advance()
    }

    if (rows.length === 0) {
      this.addError('Tilemap must include at least one row string', nameToken)
    }

    return { kind: 'tilemap', name, tilesetName, rows, rowSpans, pos }
  }

  private parseMap(): MapNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'map'

    const nameToken = this.expect('STRING', 'Expected tilemap name like "field"')
    const name = nameToken.value

    if (this.check('KEYWORD') && this.peek().value === 'at') {
      this.advance()
    }

    const coord = this.parseCoordinateForCommand(
      'map',
      'Expected map origin like 8,8, +1,+0, "center", or anchor name'
    )

    return {
      kind: 'map',
      name,
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      pos
    }
  }

  private parseScatter(): ScatterNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'scatter'

    const nameToken = this.expect('STRING', 'Expected stamp name like "tree"')
    const name = nameToken.value

    // Expect 'in' keyword
    if (this.check('KEYWORD') && this.peek().value === 'in') {
      this.advance()
    } else {
      this.addError('Expected "in" after scatter name', this.peek())
    }

    // Parse origin coordinate
    const coord = this.parseCoordinateForCommand('scatter', 'Expected coordinate for scatter region')
    // Parse region dimension (WxH or expression pair)
    const { width, height } = this.parseSizePair('Expected size like 32x32, expression, or expression x expression for scatter region')

    // Parse count and seed
    let count: ScalarValue = 10
    let seed: ScalarValue = 0

    while (this.check('KEYWORD')) {
      const kw = this.peek().value
      if (kw === 'count') {
        this.advance()
        count = this.parseRequiredScalar('Expected number after count')
      } else if (kw === 'seed') {
        this.advance()
        seed = this.parseRequiredScalar('Expected number after seed')
      } else {
        break
      }
    }

    return {
      kind: 'scatter',
      name,
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      width,
      height,
      count,
      seed,
      pos
    }
  }

  private parseEmit(): EmitNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'emit'

    const nameToken = this.expect('STRING', 'Expected stamp name like "spark"')
    const name = nameToken.value

    // Optional 'at'
    if (this.check('KEYWORD') && this.peek().value === 'at') {
      this.advance()
    }

    const coord = this.parseCoordinateForCommand('emit', 'Expected coordinate for emit origin')
    let count: ScalarValue = 10
    let spreadWidth: ScalarValue = 0
    let spreadHeight: ScalarValue = 0
    let driftX: ScalarValue = 0
    let driftY: ScalarValue = 0
    let driftTime: ScalarValue | undefined
    let velX: ScalarValue = 0
    let velY: ScalarValue = 0
    let jitterX: ScalarValue = 0
    let jitterY: ScalarValue = 0
    let activeStart: ScalarValue | undefined
    let activeEnd: ScalarValue | undefined
    let life: ScalarValue | undefined
    let loop: ScalarValue | undefined
    let fade = false
    let seed: ScalarValue = 0

    while (true) {
      this.skipNewlines()
      if (!this.check('KEYWORD')) break

      const kw = this.peek().value
      if (kw === 'count') {
        this.advance()
        count = this.parseRequiredScalar('Expected number after count')
      } else if (kw === 'spread') {
        this.advance()
        const spread = this.parseSizePair('Expected spread like 6x4 or expression x expression')
        spreadWidth = spread.width
        spreadHeight = spread.height
      } else if (kw === 'drift') {
        this.advance()
        const drift = this.parseSizePair('Expected drift like -2x1 or expression x expression')
        driftX = drift.width
        driftY = drift.height
      } else if (kw === 'time') {
        this.advance()
        driftTime = this.parseRequiredScalar('Expected expression after time')
      } else if (kw === 'vel') {
        this.advance()
        const velocity = this.parseSizePair('Expected velocity like -2x1 or expression x expression')
        velX = velocity.width
        velY = velocity.height
      } else if (kw === 'jitter') {
        this.advance()
        const jitter = this.parseSizePair('Expected jitter like 2x2 or expression x expression')
        jitterX = jitter.width
        jitterY = jitter.height
      } else if (kw === 'active') {
        this.advance()
        activeStart = this.parseRequiredScalar('Expected active range start after active')
        if (this.check('RANGE')) {
          this.advance()
        } else if (!this.isExpressionStart(this.peek())) {
          this.addError('Expected active range end after active (use "active START..END")', this.peek())
          throw new Error('Expected active range end after active')
        }
        activeEnd = this.parseRequiredScalar('Expected active range end after active')
      } else if (kw === 'life') {
        this.advance()
        life = this.parseRequiredScalar('Expected number after life')
      } else if (kw === 'loop') {
        this.advance()
        loop = this.parseRequiredScalar('Expected loop length after loop')
      } else if (kw === 'fade') {
        this.advance()
        fade = true
      } else if (kw === 'seed') {
        this.advance()
        seed = this.parseRequiredScalar('Expected number after seed')
      } else {
        break
      }
    }

    return {
      kind: 'emit',
      name,
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      count,
      spreadWidth,
      spreadHeight,
      driftX,
      driftY,
      driftTime,
      velX,
      velY,
      jitterX,
      jitterY,
      activeStart,
      activeEnd,
      life,
      loop,
      fade,
      seed,
      pos
    }
  }

  private parseLayer(): LayerNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'layer'

    const nameToken = this.expect('STRING', 'Expected layer name like "foreground"')
    const name = nameToken.value
    if (name.length === 0) {
      this.addError('Layer name cannot be empty', nameToken)
    }

    return { kind: 'layer', name, pos }
  }

  private parseWith(): ASTNode[] {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'with'

    const layerToken = this.expect('KEYWORD', 'Expected "layer" after with')
    if (layerToken.value !== 'layer') {
      this.addError('Expected "layer" after with', layerToken)
      throw new Error('Expected "layer" after with')
    }

    const nameToken = this.expect('STRING', 'Expected layer name like "foreground"')
    const name = nameToken.value
    if (name.length === 0) {
      this.addError('Layer name cannot be empty', nameToken)
    }

    this.skipNewlines()
    let clearBeforeBody = false
    if (this.check('KEYWORD') && this.peek().value === 'clear') {
      this.advance()
      clearBeforeBody = true
    }

    this.skipNewlines()
    this.expect('LBRACE', 'Expected { after with layer scope')
    const body = this.parseBlock()
    this.markIncludesFromWithLayerScope(body)

    const expanded: ASTNode[] = [
      { kind: 'push', pos },
      { kind: 'layer', name, pos }
    ]
    if (clearBeforeBody) {
      expanded.push({ kind: 'clear', layerName: undefined, color: undefined, pos })
    }
    expanded.push(...body)
    expanded.push({ kind: 'pop', pos })
    return expanded
  }

  private parseClear(): ClearNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'clear'

    let layerName: string | undefined
    let color: Color | undefined

    if (this.check('KEYWORD') && this.peek().value === 'layer') {
      this.advance() // consume 'layer'
      const nameToken = this.expect('STRING', 'Expected layer name like "foreground"')
      layerName = nameToken.value
      if (layerName.length === 0) {
        this.addError('Layer name cannot be empty', nameToken)
      }
    }

    if (this.isColorStartToken(this.peek())) {
      color = this.parseColor()
    }

    return { kind: 'clear', layerName, color, pos }
  }

  private parsePush(): PushNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'push'
    return { kind: 'push', pos }
  }

  private parsePop(): PopNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'pop'
    return { kind: 'pop', pos }
  }

  private parseOutlineRect(): OutlineRectNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'orect'

    const coord = this.parseCoordinateForCommand('orect')

    const { width, height } = this.parseSizePair()

    const color = this.parseColor()

    return {
      kind: 'orect',
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      width,
      height,
      color,
      pos
    }
  }

  private parseOutlineCircle(): OutlineCircleNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'ocirc'

    const coord = this.parseCoordinateForCommand('ocirc')

    let radius: ScalarValue = 4
    if (this.check('KEYWORD') && this.peek().value.startsWith('r')) {
      const rToken = this.advance()
      const compactRadius = rToken.value.slice(1)
      if (!/^\d+$/.test(compactRadius)) {
        this.addError(
          `Invalid radius token "${rToken.value}". Use rN or a numeric expression (for variables, use $name like $r).`,
          rToken
        )
        throw new Error('Invalid radius token')
      }
      radius = Number(compactRadius)
    } else if (this.isExpressionStart(this.peek())) {
      radius = this.parseScalarExpression()
    }

    const color = this.parseColor()

    return {
      kind: 'ocirc',
      cx: coord.x,
      cy: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      radius,
      color,
      pos
    }
  }

  private parseOutlinePolygon(): OutlinePolygonNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'opoly'

    const points = this.parseCoordinates(true, 'opoly')

    const color = this.parseColor()

    return { kind: 'opoly', points, color, pos }
  }

  private parseGlow(): GlowNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'glow'

    const coord = this.parseCoordinateForCommand(
      'glow',
      'Expected glow position like 8,8, "center", or anchor name'
    )

    // Parse radius
    let radius: ScalarValue = 4
    if (this.check('KEYWORD') && this.peek().value.startsWith('r')) {
      const rToken = this.advance()
      const compactRadius = rToken.value.slice(1)
      if (!/^\d+$/.test(compactRadius)) {
        this.addError(
          `Invalid radius token "${rToken.value}". Use rN or a numeric expression (for variables, use $name like $r).`,
          rToken
        )
        throw new Error('Invalid radius token')
      }
      radius = Number(compactRadius)
    } else if (this.isExpressionStart(this.peek())) {
      radius = this.parseScalarExpression()
    }

    const color = this.parseColor()

    return {
      kind: 'glow',
      cx: coord.x,
      cy: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      radius,
      color,
      pos
    }
  }

  private parseEllipse(): EllipseNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'ellipse'

    const coord = this.parseCoordinateForCommand(
      'ellipse',
      'Expected ellipse position like 8,8, "center", or anchor name'
    )

    const { width: rx, height: ry } = this.parseSizePair('Expected radii like 6x3')

    const color = this.parseColor()

    return {
      kind: 'ellipse',
      cx: coord.x,
      cy: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      rx,
      ry,
      color,
      pos
    }
  }

  private parseOutlineEllipse(): OutlineEllipseNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'oellipse'

    const coord = this.parseCoordinateForCommand(
      'oellipse',
      'Expected ellipse position like 8,8, "center", or anchor name'
    )

    const { width: rx, height: ry } = this.parseSizePair('Expected radii like 6x3')

    const color = this.parseColor()

    return {
      kind: 'oellipse',
      cx: coord.x,
      cy: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      rx,
      ry,
      color,
      pos
    }
  }

  private parseDither(): DitherNode {
    const pos = { line: this.peek().line, column: this.peek().column }
    this.advance() // consume 'dither'

    if (!(this.check('KEYWORD'))) {
      this.addError('Expected dither mode: checker, bayer, or noise', this.peek())
      throw new Error('Expected dither mode')
    }

    const modeToken = this.advance()
    const modeValue = modeToken.value
    if (modeValue !== 'checker' && modeValue !== 'bayer' && modeValue !== 'noise') {
      this.addError(`Unknown dither mode "${modeValue}". Use checker, bayer, or noise.`, modeToken)
      throw new Error('Unknown dither mode')
    }

    if (this.check('KEYWORD') && this.peek().value === 'at') {
      this.advance()
    }

    const coord = this.parseCoordinateForCommand(
      'dither',
      'Expected dither origin like 8,8, "center", or anchor name'
    )

    const { width, height } = this.parseSizePair('Expected dither size like 8x8, 8, expression, or expression x expression')

    if (!this.isColorStartToken(this.peek())) {
      this.addError('Expected first dither color', this.peek())
      throw new Error('Expected first dither color')
    }
    const colorA = this.parseColor()

    if (!this.isColorStartToken(this.peek())) {
      this.addError('Expected second dither color', this.peek())
      throw new Error('Expected second dither color')
    }
    const colorB = this.parseColor()

    let seed: ScalarValue = 0
    while (this.check('KEYWORD')) {
      const kw = this.peek().value
      if (kw === 'seed') {
        this.advance()
        seed = this.parseRequiredScalar('Expected number after seed')
      } else {
        break
      }
    }

    return {
      kind: 'dither',
      mode: modeValue,
      x: coord.x,
      y: coord.y,
      isCenter: coord.isCenter,
      isRelativeX: coord.isRelativeX,
      isRelativeY: coord.isRelativeY,
      anchorName: coord.anchorName,
      boxName: coord.boxName,
      boxPoint: coord.boxPoint,
      width,
      height,
      colorA,
      colorB,
      seed,
      pos
    }
  }

  private tryParsePointForList(expectColorAfter: boolean): Point | null {
    if (this.check('KEYWORD') && this.peek().value === 'box') {
      const startPos = this.pos
      try {
        return this.parseBoxReferencePoint()
      } catch {
        this.pos = startPos
        return null
      }
    }

    if (this.check('COORD')) {
      const coord = this.advance()
      return this.parseCoordValue(coord.value)
    }

    if (this.check('KEYWORD') && this.peek().value === 'center') {
      this.advance()
      return { x: 0, y: 0, isCenter: true, isRelativeX: false, isRelativeY: false }
    }

    if (this.check('KEYWORD') && !isReservedWord(this.peek().value)) {
      if (expectColorAfter) {
        const nextToken = this.tokens[this.pos + 1]
        if (nextToken && (nextToken.type === 'NEWLINE' || nextToken.type === 'EOF' || nextToken.type === 'RBRACE')) {
          return null
        }
      }

      const anchorToken = this.advance()
      const anchorName = anchorToken.value
      return {
        x: 0,
        y: 0,
        isCenter: false,
        isRelativeX: false,
        isRelativeY: false,
        anchorName,
        anchorPos: { line: anchorToken.line, column: anchorToken.column }
      }
    }

    const exprCoord = this.tryParseExpressionCoordinate()
    if (!exprCoord) {
      return null
    }

    return {
      x: exprCoord.x,
      y: exprCoord.y,
      isCenter: exprCoord.isCenter,
      isRelativeX: exprCoord.isRelativeX,
      isRelativeY: exprCoord.isRelativeY,
      anchorName: exprCoord.anchorName,
      anchorPos: exprCoord.anchorPos,
      boxName: exprCoord.boxName,
      boxPoint: exprCoord.boxPoint,
      boxPos: exprCoord.boxPos
    }
  }

  private tryParseWrappedCoordinateExpression(): ParsedCoordinate | null {
    const startPos = this.pos
    if (!this.check('LPAREN')) return null
    this.advance()

    if (this.check('COORD')) {
      const coordToken = this.advance()
      const parsed = this.parseCoordValue(coordToken.value)
      this.expect('RPAREN', 'Expected ")" after coordinate expression')
      return {
        x: parsed.x,
        y: parsed.y,
        isCenter: false,
        isRelativeX: false,
        isRelativeY: false
      }
    }

    if (!this.isExpressionStart(this.peek())) {
      this.pos = startPos
      return null
    }
    const x = this.parseScalarExpression()
    if (!this.check('COMMA')) {
      this.pos = startPos
      return null
    }
    this.advance()
    if (!this.isExpressionStart(this.peek())) {
      this.addError('Expected expression after comma in coordinate', this.peek())
      throw new Error('Expected expression after comma in coordinate')
    }
    const y = this.parseScalarExpression()
    this.expect('RPAREN', 'Expected ")" after coordinate expression')
    return {
      x,
      y,
      isCenter: false,
      isRelativeX: false,
      isRelativeY: false
    }
  }

  private tryParseCoordinateAxis(): { value: ScalarValue; isRelative: boolean } | null {
    const startPos = this.pos
    let wrapped = false
    if (this.check('LPAREN')) {
      wrapped = true
      this.advance()
    }

    if (!this.isExpressionStart(this.peek())) {
      this.pos = startPos
      return null
    }
    const isRelative = !wrapped && (this.check('PLUS') || this.check('MINUS'))
    const value = this.parseScalarExpression()
    if (wrapped) {
      if (!this.check('RPAREN')) {
        this.pos = startPos
        return null
      }
      this.advance()
    }
    return { value, isRelative }
  }

  private tryParseExpressionCoordinate(): ParsedCoordinate | null {
    const wrappedCoord = this.tryParseWrappedCoordinateExpression()
    if (wrappedCoord) return wrappedCoord

    const startPos = this.pos
    const xAxis = this.tryParseCoordinateAxis()
    if (!xAxis) {
      this.pos = startPos
      return null
    }

    if (!this.check('COMMA')) {
      this.pos = startPos
      return null
    }
    this.advance()

    const yAxis = this.tryParseCoordinateAxis()
    if (!yAxis) {
      this.addError('Expected expression after comma in coordinate', this.peek())
      throw new Error('Expected expression after comma in coordinate')
    }

    return {
      x: xAxis.value,
      y: yAxis.value,
      isCenter: false,
      isRelativeX: xAxis.isRelative,
      isRelativeY: yAxis.isRelative
    }
  }

  private parseSizePair(errorMessage = 'Expected size like 8x8, sizeAlias, 8, expression, or expression x expression'):
  { width: ScalarValue; height: ScalarValue } {
    if (
      (this.check('PLUS') || this.check('MINUS')) &&
      this.tokens[this.pos + 1]?.type === 'DIMENSION'
    ) {
      const signToken = this.advance()
      const sign = signToken.type === 'MINUS' ? -1 : 1
      const dim = this.advance()
      const [rawWidth, height] = dim.value.split('x').map(Number)
      return { width: rawWidth * sign, height }
    }

    if (this.check('DIMENSION')) {
      const dim = this.advance()
      const [width, height] = dim.value.split('x').map(Number)
      return { width, height }
    }

    if (this.check('KEYWORD') && !isReservedWord(this.peek().value)) {
      const token = this.advance()
      const pairRef: Expr = {
        kind: 'pairVar',
        name: token.value,
        pos: { line: token.line, column: token.column }
      }
      return { width: pairRef, height: this.cloneExpr(pairRef) }
    }

    if (this.isExpressionStart(this.peek())) {
      const width = this.parseScalarExpression()
      const sepToken = this.peek()

      if (
        sepToken.type === 'KEYWORD' &&
        sepToken.value === 'x' &&
        this.isExpressionStart(this.tokens[this.pos + 1] || { type: 'EOF', value: '', line: 0, column: 0 })
      ) {
        this.advance() // consume separator 'x'
        const height = this.parseScalarExpression()
        return { width, height }
      }

      if (sepToken.type === 'KEYWORD') {
        const compactMatch = sepToken.value.match(/^x(\d+)$/)
        if (compactMatch) {
          this.advance() // consume compact separator + literal height, e.g. x4
          return { width, height: Number(compactMatch[1]) }
        }
      }

      return { width, height: width }
    }

    this.addError(errorMessage, this.peek())
    return { width: 1, height: 1 }
  }

  private parseRequiredScalar(errorMessage: string): ScalarValue {
    if (!this.isExpressionStart(this.peek())) {
      this.addError(errorMessage, this.peek())
      throw new Error(errorMessage)
    }
    return this.parseScalarExpression()
  }

  private parseScalarExpression(): ScalarValue {
    const expr = this.parseExpression()
    if (expr.kind === 'literal') {
      return expr.value
    }
    return expr
  }

  private parseExpression(): Expr {
    return this.parseAdditive()
  }

  private parseAdditive(): Expr {
    let expr = this.parseMultiplicative()

    while (this.check('PLUS') || this.check('MINUS')) {
      const op = this.advance().type === 'PLUS' ? '+' : '-'
      const right = this.parseMultiplicative()
      expr = { kind: 'binary', op, left: expr, right }
    }

    return expr
  }

  private parseMultiplicative(): Expr {
    let expr = this.parseUnary()

    while (this.check('STAR') || this.check('SLASH') || this.check('PERCENT')) {
      const tokenType = this.advance().type
      const op = tokenType === 'STAR' ? '*' : tokenType === 'SLASH' ? '/' : '%'
      const right = this.parseUnary()
      expr = { kind: 'binary', op, left: expr, right }
    }

    return expr
  }

  private parseUnary(): Expr {
    if (this.check('PLUS') || this.check('MINUS')) {
      const op = this.advance().type === 'PLUS' ? '+' : '-'
      const expr = this.parseUnary()
      return { kind: 'unary', op, expr }
    }

    return this.parsePrimary()
  }

  private parseIntrinsicCall(): Expr {
    const nameToken = this.expect('KEYWORD', 'Expected intrinsic name')
    const name = nameToken.value

    if (!isExpressionIntrinsic(name)) {
      this.addError(`Unknown expression intrinsic "${name}"`, nameToken, 'P006')
      throw new Error(`Unknown expression intrinsic "${name}"`)
    }

    this.expect('LPAREN', `Expected "(" after intrinsic "${name}"`)

    const args: Expr[] = []
    if (!this.check('RPAREN')) {
      while (true) {
        args.push(this.parseExpression())
        if (!this.check('COMMA')) break
        this.advance()
      }
    }
    this.expect('RPAREN', `Expected ")" after intrinsic "${name}" arguments`)

    const expectedArgCount = getExpressionIntrinsicArity(name)
    if (args.length !== expectedArgCount) {
      this.addError(
        `Intrinsic "${name}" expects ${expectedArgCount} argument${expectedArgCount === 1 ? '' : 's'}, got ${args.length}`,
        nameToken
      )
    }

    const normalizedArgs = args.slice(0, expectedArgCount)
    while (normalizedArgs.length < expectedArgCount) {
      normalizedArgs.push({ kind: 'literal', value: 0 })
    }

    return { kind: 'call', name, args: normalizedArgs }
  }

  private parsePrimary(): Expr {
    if (this.check('NUMBER')) {
      const value = Number(this.advance().value)
      return { kind: 'literal', value }
    }

    if (this.check('VAR')) {
      const token = this.advance()
      const name = token.value
      if (name.length === 0) {
        this.addError('Expected variable name after "$"', this.peek())
        throw new Error('Expected variable name after "$"')
      }
      return {
        kind: 'var',
        name,
        pos: { line: token.line, column: token.column }
      }
    }

    if (this.check('KEYWORD') && isExpressionIntrinsic(this.peek().value)) {
      return this.parseIntrinsicCall()
    }

    if (this.check('LPAREN')) {
      this.advance()
      const expr = this.parseExpression()
      this.expect('RPAREN', 'Expected ")" after expression')
      return expr
    }

    this.addError('Expected number, variable, intrinsic call, or parenthesized expression', this.peek())
    throw new Error('Expected number, variable, intrinsic call, or parenthesized expression')
  }

  private isExpressionStart(token: Token): boolean {
    return token.type === 'NUMBER' ||
      token.type === 'VAR' ||
      token.type === 'LPAREN' ||
      token.type === 'PLUS' ||
      token.type === 'MINUS' ||
      (token.type === 'KEYWORD' && isExpressionIntrinsic(token.value))
  }

  private parseTransformFlags(options?: {
    commandName?: string
    allowCenterOnTarget?: boolean
    allowTargetPivot?: boolean
  }): { centerOnTarget: boolean; useTargetPivot: boolean; flipX: boolean; flipY: boolean; rotation: 0 | 90 | 180 | 270 } {
    const commandLabel = options?.commandName ?? 'command'
    const allowCenterOnTarget = options?.allowCenterOnTarget === true
    const allowTargetPivot = options?.allowTargetPivot === true
    let centerOnTarget = false
    let useTargetPivot = false
    let flipX = false
    let flipY = false
    let rotation: 0 | 90 | 180 | 270 = 0

    while (this.check('SYMBOL')) {
      const sym = this.peek().value
      if (sym === ':center') {
        if (allowCenterOnTarget) {
          centerOnTarget = true
        } else {
          this.addError(`"${commandLabel}" does not support :center`, this.peek())
        }
        this.advance()
      } else if (sym === ':pivot') {
        if (allowTargetPivot) {
          useTargetPivot = true
        } else {
          this.addError(`"${commandLabel}" does not support :pivot`, this.peek())
        }
        this.advance()
      } else if (sym === ':flipx') {
        flipX = true
        this.advance()
      } else if (sym === ':flipy') {
        flipY = true
        this.advance()
      } else if (sym === ':rot90') {
        rotation = 90
        this.advance()
      } else if (sym === ':rot180') {
        rotation = 180
        this.advance()
      } else if (sym === ':rot270') {
        rotation = 270
        this.advance()
      } else {
        this.addError(`Invalid transform flag: ${sym}`, this.peek())
        this.advance()
      }
    }

    return { centerOnTarget, useTargetPivot, flipX, flipY, rotation }
  }

  private parseBlock(): ASTNode[] {
    const body: ASTNode[] = []
    this.blockDepth++
    try {
      this.skipNewlines()

      while (!this.isAtEnd() && !this.check('RBRACE')) {
        this.skipNewlines()
        if (this.check('RBRACE')) break

        try {
          const parsed = this.parseStatement()
          this.appendParsedStatement(body, parsed)
        } catch (e) {
          this.skipToNextLine()
        }

        this.skipNewlines()
      }

      // Consume closing brace
      if (this.check('RBRACE')) {
        this.advance()
      }
    } finally {
      this.blockDepth = Math.max(0, this.blockDepth - 1)
    }

    return body
  }

  private validateFrameBody(nodes: ASTNode[]): void {
    for (const node of nodes) {
      if (
        node.kind === 'canvas' ||
        node.kind === 'include' ||
        node.kind === 'palette' ||
        node.kind === 'group' ||
        node.kind === 'bitmap' ||
        node.kind === 'tileset' ||
        node.kind === 'tilemap' ||
        node.kind === 'font' ||
        node.kind === 'frame'
      ) {
        this.errors.push({
          code: 'P005',
          message: `"${node.kind}" is not allowed inside a frame`,
          line: node.pos.line,
          column: node.pos.column,
        })
      }

      if (node.kind === 'repeat') {
        this.validateFrameBody(node.body)
      }
    }
  }

  private markIncludesFromWithLayerScope(nodes: ASTNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'include') {
        node.fromWithLayerScope = true
        continue
      }
      if (node.kind === 'group' || node.kind === 'repeat' || node.kind === 'frame') {
        this.markIncludesFromWithLayerScope(node.body)
      }
    }
  }

  private parseUnsignedInteger(errorMessage: string, label: string): { value: number; token: Token } {
    const token = this.expect('NUMBER', errorMessage)
    const value = this.parseIntegerTokenValue(token, label)
    return { value: Math.max(0, value), token }
  }

  private parseIntegerTokenValue(token: Token, label: string): number {
    const value = Number(token.value)
    if (Number.isInteger(value)) return value
    this.addError(`${label} must be an integer (got ${token.value})`, token)
    return Math.trunc(value)
  }

  private parseSignedInteger(errorMessage: string, label = 'Value'): { value: number; token: Token } {
    if (this.check('NUMBER')) {
      const token = this.advance()
      return { value: this.parseIntegerTokenValue(token, label), token }
    }

    if (this.check('PLUS') || this.check('MINUS')) {
      const signToken = this.advance()
      const sign = signToken.type === 'MINUS' ? -1 : 1
      if (this.check('NUMBER')) {
        const token = this.advance()
        return { value: sign * this.parseIntegerTokenValue(token, label), token: signToken }
      }
      this.addError(errorMessage, this.peek())
      throw new Error(errorMessage)
    }

    this.addError(errorMessage, this.peek())
    throw new Error(errorMessage)
  }

  private cloneExpr(expr: Expr): Expr {
    switch (expr.kind) {
      case 'literal':
        return { kind: 'literal', value: expr.value }
      case 'var':
        return { kind: 'var', name: expr.name, pos: expr.pos ? { ...expr.pos } : undefined }
      case 'pairVar':
        return { kind: 'pairVar', name: expr.name, pos: expr.pos ? { ...expr.pos } : undefined }
      case 'unary':
        return { kind: 'unary', op: expr.op, expr: this.cloneExpr(expr.expr) }
      case 'binary':
        return {
          kind: 'binary',
          op: expr.op,
          left: this.cloneExpr(expr.left),
          right: this.cloneExpr(expr.right)
        }
      case 'call':
        return {
          kind: 'call',
          name: expr.name,
          args: expr.args.map((arg) => this.cloneExpr(arg))
        }
    }
  }

  private parseColor(): Color {
    if (this.check('HEX_COLOR')) {
      const token = this.advance()
      const hex = token.value
      if (!isValidHexColorLiteral(hex)) {
        this.addError(
          `Invalid hex color "${hex}". Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`,
          token
        )
        return { type: 'current' }
      }
      return { type: 'hex', value: hex }
    }

    if (this.check('NUMBER')) {
      const index = Number(this.advance().value)
      return { type: 'index', value: index }
    }

    if (this.check('PLUS') || this.check('MINUS')) {
      const sign = this.advance().type === 'MINUS' ? -1 : 1
      if (this.check('NUMBER')) {
        const index = sign * Number(this.advance().value)
        return { type: 'index', value: index }
      }
      this.addError('Expected number after color sign', this.peek())
      return { type: 'current' }
    }

    // Check for named color.
    if (this.check('KEYWORD')) {
      const name = this.peek().value
      this.advance()
      return { type: 'name', value: name }
    }

    // Use current color if none specified
    return { type: 'current' }
  }

  private isColorStartToken(token: Token): boolean {
    return (
      token.type === 'HEX_COLOR' ||
      token.type === 'NUMBER' ||
      token.type === 'PLUS' ||
      token.type === 'MINUS' ||
      token.type === 'KEYWORD'
    )
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, column: 0 }
  }

  private advance(): Token {
    const token = this.peek()
    this.pos++
    return token
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF'
  }

  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance()
    }
    const token = this.peek()
    if (type === 'STRING' && token.type === 'UNTERMINATED_STRING') {
      this.addError('Unterminated string literal. Add a closing quote (").', token, 'P003')
      throw new Error(message)
    }
    this.addError(message, token, 'P003')
    throw new Error(message)
  }

  private skipNewlines(): void {
    while (this.check('NEWLINE')) {
      this.advance()
    }
  }

  private skipToNextLine(): void {
    while (!this.isAtEnd() && !this.check('NEWLINE')) {
      this.advance()
    }
    if (this.check('NEWLINE')) {
      this.advance()
    }
  }

  private addError(message: string, token: Token, code: ParseErrorCode = 'P003'): void {
    this.errors.push({ code, message, line: token.line, column: token.column })
  }
}

export function parse(input: string): { program: Program; errors: ParseError[] } {
  return new Parser().parse(input)
}
