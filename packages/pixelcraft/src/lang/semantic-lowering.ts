import { ASTNode, Expr, Point, Program, ScalarValue } from './ast'
import {
  buildSemanticSymbolModel,
  extractDirectPairReferenceName,
  isExpr,
  resolveVisibleConstBinding,
  resolveVisibleDefPointBinding,
  resolveVisiblePairBinding
} from './semantic-symbol-model'
import { BoundProgram, ResolvedProgram } from './semantic-types'

interface PairTemplate {
  width: Expr
  height: Expr
}

interface PointTemplate {
  mode: 'absolute' | 'anchor' | 'box'
  x: Expr
  y: Expr
  anchorName?: string
  boxName?: string
  boxPoint?: Point['boxPoint']
}

interface CoordinateKeySet {
  xKey: string
  yKey: string
  isCenterKey: string
  isRelativeXKey: string
  isRelativeYKey: string
  anchorNameKey: string
  boxNameKey: string
  boxPointKey: string
}

const ROOT_COORD_KEYS: CoordinateKeySet = {
  xKey: 'x',
  yKey: 'y',
  isCenterKey: 'isCenter',
  isRelativeXKey: 'isRelativeX',
  isRelativeYKey: 'isRelativeY',
  anchorNameKey: 'anchorName',
  boxNameKey: 'boxName',
  boxPointKey: 'boxPoint'
}
const COORD1_KEYS: CoordinateKeySet = {
  xKey: 'x1',
  yKey: 'y1',
  isCenterKey: 'isCenter1',
  isRelativeXKey: 'isRelativeX1',
  isRelativeYKey: 'isRelativeY1',
  anchorNameKey: 'anchorName1',
  boxNameKey: 'boxName1',
  boxPointKey: 'boxPoint1'
}
const COORD2_KEYS: CoordinateKeySet = {
  xKey: 'x2',
  yKey: 'y2',
  isCenterKey: 'isCenter2',
  isRelativeXKey: 'isRelativeX2',
  isRelativeYKey: 'isRelativeY2',
  anchorNameKey: 'anchorName2',
  boxNameKey: 'boxName2',
  boxPointKey: 'boxPoint2'
}
const CENTER_COORD_KEYS: CoordinateKeySet = {
  xKey: 'cx',
  yKey: 'cy',
  isCenterKey: 'isCenter',
  isRelativeXKey: 'isRelativeX',
  isRelativeYKey: 'isRelativeY',
  anchorNameKey: 'anchorName',
  boxNameKey: 'boxName',
  boxPointKey: 'boxPoint'
}

export function lowerSemanticProgram(resolved: ResolvedProgram): Program {
  const boundForLowering = resolvedToBoundProgram(resolved)
  const symbolModel = buildSemanticSymbolModel(boundForLowering)

  const expandedConstExprs = new Map<typeof symbolModel.constBindings[number], Expr>()
  const expandingConst = new Set<typeof symbolModel.constBindings[number]>()

  const expandConstBinding = (binding: typeof symbolModel.constBindings[number]): Expr => {
    const memoized = expandedConstExprs.get(binding)
    if (memoized) return cloneExpr(memoized)
    if (expandingConst.has(binding) || symbolModel.constCycleBindings.has(binding)) {
      return { kind: 'literal', value: 0 }
    }

    expandingConst.add(binding)
    const expanded = rewriteExpr(binding.node.value, binding.scopeId)
    expandingConst.delete(binding)
    expandedConstExprs.set(binding, expanded)
    return cloneExpr(expanded)
  }

  const rewriteExpr = (expr: Expr, scopeId: number): Expr => {
    switch (expr.kind) {
      case 'literal':
        return { kind: 'literal', value: expr.value }
      case 'var': {
        const target = resolveVisibleConstBinding(expr.name, scopeId, symbolModel)
        if (!target) return { kind: 'var', name: expr.name, pos: expr.pos ? { ...expr.pos } : undefined }
        return expandConstBinding(target)
      }
      case 'pairVar':
        return { kind: 'pairVar', name: expr.name, pos: expr.pos ? { ...expr.pos } : undefined }
      case 'unary':
        return { kind: 'unary', op: expr.op, expr: rewriteExpr(expr.expr, scopeId) }
      case 'binary':
        return {
          kind: 'binary',
          op: expr.op,
          left: rewriteExpr(expr.left, scopeId),
          right: rewriteExpr(expr.right, scopeId)
        }
      case 'call':
        return {
          kind: 'call',
          name: expr.name,
          args: expr.args.map((arg) => rewriteExpr(arg, scopeId))
        }
    }
  }

  const rewriteScalarValue = (value: ScalarValue, scopeId: number): ScalarValue => {
    if (typeof value === 'number') return value
    const rewritten = rewriteExpr(value, scopeId)
    return rewritten.kind === 'literal' ? rewritten.value : rewritten
  }

  const expandedPairTemplates = new Map<typeof symbolModel.pairBindings[number], PairTemplate>()
  const expandingPair = new Set<typeof symbolModel.pairBindings[number]>()

  const expandPairBinding = (binding: typeof symbolModel.pairBindings[number]): PairTemplate => {
    const memoized = expandedPairTemplates.get(binding)
    if (memoized) return clonePairTemplate(memoized)
    if (expandingPair.has(binding) || symbolModel.pairCycleBindings.has(binding)) {
      return {
        width: { kind: 'literal', value: 0 },
        height: { kind: 'literal', value: 0 }
      }
    }

    expandingPair.add(binding)
    const expanded = pairDeclarationToTemplate(binding.node.width, binding.node.height, binding.scopeId)
    expandingPair.delete(binding)
    expandedPairTemplates.set(binding, expanded)
    return clonePairTemplate(expanded)
  }

  const pairDeclarationToTemplate = (
    width: ScalarValue,
    height: ScalarValue,
    scopeId: number
  ): PairTemplate => {
    const directReference = extractDirectPairReferenceName(width, height)
    if (!directReference) {
      return {
        width: scalarToExpr(rewriteScalarValue(width, scopeId)),
        height: scalarToExpr(rewriteScalarValue(height, scopeId))
      }
    }

    const target = resolveVisiblePairBinding(directReference, scopeId, symbolModel)
    if (!target) {
      return {
        width: scalarToExpr(rewriteScalarValue(width, scopeId)),
        height: scalarToExpr(rewriteScalarValue(height, scopeId))
      }
    }
    return expandPairBinding(target)
  }

  const rewritePairComponents = (
    width: ScalarValue,
    height: ScalarValue,
    scopeId: number
  ): { width: ScalarValue; height: ScalarValue } => {
    const directReference = extractDirectPairReferenceName(width, height)
    if (!directReference) {
      return {
        width: rewriteScalarValue(width, scopeId),
        height: rewriteScalarValue(height, scopeId)
      }
    }

    const target = resolveVisiblePairBinding(directReference, scopeId, symbolModel)
    if (!target) {
      return {
        width: rewriteScalarValue(width, scopeId),
        height: rewriteScalarValue(height, scopeId)
      }
    }

    const template = expandPairBinding(target)
    return {
      width: exprToScalar(template.width),
      height: exprToScalar(template.height)
    }
  }

  const expandedDefPointTemplates = new Map<typeof symbolModel.defPointBindings[number], PointTemplate>()
  const expandingDefPoint = new Set<typeof symbolModel.defPointBindings[number]>()

  const expandDefPointBinding = (binding: typeof symbolModel.defPointBindings[number]): PointTemplate => {
    const memoized = expandedDefPointTemplates.get(binding)
    if (memoized) return clonePointTemplate(memoized)
    if (expandingDefPoint.has(binding) || symbolModel.defPointCycleBindings.has(binding)) {
      return {
        mode: 'absolute',
        x: { kind: 'literal', value: 0 },
        y: { kind: 'literal', value: 0 }
      }
    }

    expandingDefPoint.add(binding)
    const expanded = pointDeclarationToTemplate(binding.node.point, binding.scopeId)
    expandingDefPoint.delete(binding)
    expandedDefPointTemplates.set(binding, expanded)
    return clonePointTemplate(expanded)
  }

  const pointDeclarationToTemplate = (point: Point, scopeId: number): PointTemplate => {
    const rewritten = rewritePointScalarsOnly(point, scopeId, rewriteScalarValue)
    const offsetX = scalarToExpr(rewritten.x)
    const offsetY = scalarToExpr(rewritten.y)

    if (rewritten.anchorName) {
      const target = resolveVisibleDefPointBinding(rewritten.anchorName, scopeId, symbolModel)
      if (!target) {
        return {
          mode: 'anchor',
          anchorName: rewritten.anchorName,
          x: offsetX,
          y: offsetY
        }
      }
      return offsetPointTemplate(expandDefPointBinding(target), offsetX, offsetY)
    }

    if (rewritten.boxName) {
      return {
        mode: 'box',
        boxName: rewritten.boxName,
        boxPoint: rewritten.boxPoint,
        x: offsetX,
        y: offsetY
      }
    }

    if (rewritten.isCenter) {
      return offsetPointTemplate(
        {
          mode: 'absolute',
          x: { kind: 'var', name: 'centerX' },
          y: { kind: 'var', name: 'centerY' }
        },
        offsetX,
        offsetY
      )
    }

    return {
      mode: 'absolute',
      x: offsetX,
      y: offsetY
    }
  }

  const rewritePointReference = (point: Point, scopeId: number): Point => {
    const rewritten = rewritePointScalarsOnly(point, scopeId, rewriteScalarValue)
    if (!rewritten.anchorName) {
      return rewritten
    }

    const target = resolveVisibleDefPointBinding(rewritten.anchorName, scopeId, symbolModel)
    if (!target) {
      return rewritten
    }

    const template = offsetPointTemplate(
      expandDefPointBinding(target),
      scalarToExpr(rewritten.x),
      scalarToExpr(rewritten.y)
    )
    return pointFromTemplate(template)
  }

  const rewriteCoordinateSet = (
    target: Record<string, unknown>,
    keys: CoordinateKeySet,
    scopeId: number
  ): void => {
    if (!hasCoordinateFields(target, keys)) return

    const xValue = toScalarValue(target[keys.xKey])
    const yValue = toScalarValue(target[keys.yKey])
    const isCenter = target[keys.isCenterKey]
    const isRelativeX = target[keys.isRelativeXKey]
    const isRelativeY = target[keys.isRelativeYKey]

    if (xValue === null || yValue === null) return
    if (typeof isCenter !== 'boolean' || typeof isRelativeX !== 'boolean' || typeof isRelativeY !== 'boolean') return

    const anchorRaw = target[keys.anchorNameKey]
    const boxNameRaw = target[keys.boxNameKey]
    const boxPointRaw = target[keys.boxPointKey]
    const point: Point = {
      x: xValue,
      y: yValue,
      isCenter,
      isRelativeX,
      isRelativeY,
      anchorName: typeof anchorRaw === 'string' ? anchorRaw : undefined,
      boxName: typeof boxNameRaw === 'string' ? boxNameRaw : undefined,
      boxPoint: typeof boxPointRaw === 'string' ? boxPointRaw as Point['boxPoint'] : undefined
    }
    const rewritten = rewritePointReference(point, scopeId)
    target[keys.xKey] = rewritten.x
    target[keys.yKey] = rewritten.y
    target[keys.isCenterKey] = rewritten.isCenter
    target[keys.isRelativeXKey] = rewritten.isRelativeX
    target[keys.isRelativeYKey] = rewritten.isRelativeY
    target[keys.anchorNameKey] = rewritten.anchorName
    target[keys.boxNameKey] = rewritten.boxName
    target[keys.boxPointKey] = rewritten.boxPoint
  }

  function rewriteValue(value: unknown, scopeId: number): unknown {
    if (Array.isArray(value)) {
      const rewrittenItems: unknown[] = []
      for (const item of value) {
        if (isAstNode(item)) {
          const rewrittenNode = rewriteNode(item)
          if (rewrittenNode) rewrittenItems.push(rewrittenNode)
          continue
        }
        rewrittenItems.push(rewriteValue(item, scopeId))
      }
      return rewrittenItems
    }

    if (isExpr(value)) {
      return rewriteExpr(value, scopeId)
    }

    if (!value || typeof value !== 'object') {
      return value
    }

    const rewrittenObject: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      rewrittenObject[key] = rewriteValue(nested, scopeId)
    }

    rewriteCoordinateSet(rewrittenObject, ROOT_COORD_KEYS, scopeId)
    rewriteCoordinateSet(rewrittenObject, COORD1_KEYS, scopeId)
    rewriteCoordinateSet(rewrittenObject, COORD2_KEYS, scopeId)
    rewriteCoordinateSet(rewrittenObject, CENTER_COORD_KEYS, scopeId)
    return rewrittenObject
  }

  const rewriteKnownPairFields = (node: ASTNode, scopeId: number): ASTNode => {
    switch (node.kind) {
      case 'rect': {
        const pair = rewritePairComponents(node.width, node.height, scopeId)
        return { ...node, width: pair.width, height: pair.height }
      }
      case 'orect': {
        const pair = rewritePairComponents(node.width, node.height, scopeId)
        return { ...node, width: pair.width, height: pair.height }
      }
      case 'box': {
        const pair = rewritePairComponents(node.width, node.height, scopeId)
        return { ...node, width: pair.width, height: pair.height }
      }
      case 'ellipse': {
        const pair = rewritePairComponents(node.rx, node.ry, scopeId)
        return { ...node, rx: pair.width, ry: pair.height }
      }
      case 'oellipse': {
        const pair = rewritePairComponents(node.rx, node.ry, scopeId)
        return { ...node, rx: pair.width, ry: pair.height }
      }
      case 'tile': {
        const sizePair = rewritePairComponents(node.width, node.height, scopeId)
        const rewrittenNode: ASTNode = {
          ...node,
          width: sizePair.width,
          height: sizePair.height
        }
        if (node.stepX !== undefined && node.stepY !== undefined) {
          const stepPair = rewritePairComponents(node.stepX, node.stepY, scopeId)
          return {
            ...rewrittenNode,
            stepX: stepPair.width,
            stepY: stepPair.height
          } as ASTNode
        }
        return rewrittenNode
      }
      case 'scatter': {
        const pair = rewritePairComponents(node.width, node.height, scopeId)
        return { ...node, width: pair.width, height: pair.height }
      }
      case 'emit': {
        const spreadPair = rewritePairComponents(node.spreadWidth, node.spreadHeight, scopeId)
        const driftPair = rewritePairComponents(node.driftX, node.driftY, scopeId)
        const velocityPair = rewritePairComponents(node.velX, node.velY, scopeId)
        const jitterPair = rewritePairComponents(node.jitterX, node.jitterY, scopeId)
        return {
          ...node,
          spreadWidth: spreadPair.width,
          spreadHeight: spreadPair.height,
          driftX: driftPair.width,
          driftY: driftPair.height,
          velX: velocityPair.width,
          velY: velocityPair.height,
          jitterX: jitterPair.width,
          jitterY: jitterPair.height
        }
      }
      case 'dither': {
        const pair = rewritePairComponents(node.width, node.height, scopeId)
        return { ...node, width: pair.width, height: pair.height }
      }
      case 'repeat': {
        const pair = rewritePairComponents(node.dx, node.dy, scopeId)
        return { ...node, dx: pair.width, dy: pair.height }
      }
      case 'offset': {
        const pair = rewritePairComponents(node.dx, node.dy, scopeId)
        return { ...node, dx: pair.width, dy: pair.height }
      }
      case 'letpair':
      case 'letvec':
      case 'letsz': {
        const pair = rewritePairComponents(node.width, node.height, scopeId)
        return { ...node, width: pair.width, height: pair.height }
      }
      default:
        return node
    }
  }

  function rewriteNode(node: ASTNode): ASTNode | null {
    if (node.kind === 'const' || node.kind === 'defpt' || node.kind === 'letpair' || node.kind === 'letvec' || node.kind === 'letsz') {
      return null
    }
    const scopeId = resolved.nodeScopes.get(node) ?? 0
    const rewritten = rewriteValue(node, scopeId)
    if (!rewritten || typeof rewritten !== 'object') {
      return node
    }
    return rewriteKnownPairFields(rewritten as ASTNode, scopeId)
  }

  const rewrittenStatements: ASTNode[] = []
  for (const statement of resolved.program.statements) {
    const rewrittenStatement = rewriteNode(statement)
    if (rewrittenStatement) rewrittenStatements.push(rewrittenStatement)
  }

  return {
    statements: rewrittenStatements
  }
}

function resolvedToBoundProgram(resolved: ResolvedProgram): BoundProgram {
  return {
    program: resolved.program,
    scopes: resolved.scopes,
    nodeScopes: resolved.nodeScopes,
    declarations: resolved.declarations,
    diagnostics: []
  }
}

function offsetPointTemplate(base: PointTemplate, dx: Expr, dy: Expr): PointTemplate {
  return {
    mode: base.mode,
    anchorName: base.anchorName,
    boxName: base.boxName,
    boxPoint: base.boxPoint,
    x: addExpr(base.x, dx),
    y: addExpr(base.y, dy)
  }
}

function pointFromTemplate(template: PointTemplate): Point {
  if (template.mode === 'anchor') {
    return {
      x: exprToScalar(template.x),
      y: exprToScalar(template.y),
      isCenter: false,
      isRelativeX: false,
      isRelativeY: false,
      anchorName: template.anchorName
    }
  }
  if (template.mode === 'box') {
    return {
      x: exprToScalar(template.x),
      y: exprToScalar(template.y),
      isCenter: false,
      isRelativeX: false,
      isRelativeY: false,
      boxName: template.boxName,
      boxPoint: template.boxPoint
    }
  }
  return {
    x: exprToScalar(template.x),
    y: exprToScalar(template.y),
    isCenter: false,
    isRelativeX: false,
    isRelativeY: false
  }
}

function rewritePointScalarsOnly(
  point: Point,
  scopeId: number,
  rewriteScalarValue: (value: ScalarValue, scopeId: number) => ScalarValue
): Point {
  return {
    x: rewriteScalarValue(point.x, scopeId),
    y: rewriteScalarValue(point.y, scopeId),
    isCenter: point.isCenter,
    isRelativeX: point.isRelativeX,
    isRelativeY: point.isRelativeY,
    anchorName: point.anchorName,
    anchorPos: point.anchorPos ? { ...point.anchorPos } : undefined,
    boxName: point.boxName,
    boxPoint: point.boxPoint,
    boxPos: point.boxPos ? { ...point.boxPos } : undefined
  }
}

function addExpr(left: Expr, right: Expr): Expr {
  if (isZeroExpr(left)) return cloneExpr(right)
  if (isZeroExpr(right)) return cloneExpr(left)
  return {
    kind: 'binary',
    op: '+',
    left: cloneExpr(left),
    right: cloneExpr(right)
  }
}

function isZeroExpr(expr: Expr): boolean {
  return expr.kind === 'literal' && expr.value === 0
}

function scalarToExpr(value: ScalarValue): Expr {
  if (typeof value === 'number') {
    return { kind: 'literal', value }
  }
  return cloneExpr(value)
}

function exprToScalar(expr: Expr): ScalarValue {
  if (expr.kind === 'literal') {
    return expr.value
  }
  return cloneExpr(expr)
}

function toScalarValue(value: unknown): ScalarValue | null {
  if (typeof value === 'number') return value
  if (isExpr(value)) return value
  return null
}

function hasCoordinateFields(target: Record<string, unknown>, keys: CoordinateKeySet): boolean {
  return keys.xKey in target &&
    keys.yKey in target &&
    keys.isCenterKey in target &&
    keys.isRelativeXKey in target &&
    keys.isRelativeYKey in target
}

function clonePointTemplate(template: PointTemplate): PointTemplate {
  return {
    mode: template.mode,
    anchorName: template.anchorName,
    boxName: template.boxName,
    boxPoint: template.boxPoint,
    x: cloneExpr(template.x),
    y: cloneExpr(template.y)
  }
}

function clonePairTemplate(template: PairTemplate): PairTemplate {
  return {
    width: cloneExpr(template.width),
    height: cloneExpr(template.height)
  }
}

function cloneExpr(expr: Expr): Expr {
  switch (expr.kind) {
    case 'literal':
      return { kind: 'literal', value: expr.value }
    case 'var':
      return { kind: 'var', name: expr.name, pos: expr.pos ? { ...expr.pos } : undefined }
    case 'pairVar':
      return { kind: 'pairVar', name: expr.name, pos: expr.pos ? { ...expr.pos } : undefined }
    case 'unary':
      return { kind: 'unary', op: expr.op, expr: cloneExpr(expr.expr) }
    case 'binary':
      return {
        kind: 'binary',
        op: expr.op,
        left: cloneExpr(expr.left),
        right: cloneExpr(expr.right)
      }
    case 'call':
      return {
        kind: 'call',
        name: expr.name,
        args: expr.args.map((arg) => cloneExpr(arg))
      }
  }
}

function isAstNode(value: unknown): value is ASTNode {
  if (!value || typeof value !== 'object') return false
  if (!('kind' in value)) return false
  if (isExpr(value)) return false
  return 'pos' in value
}
