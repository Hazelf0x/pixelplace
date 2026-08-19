import { ASTNode, Expr, Point, ScalarValue } from './ast'
import { createSemanticDiagnostic } from './semantic-diagnostics'
import { BoundProgram, SemanticDiagnostic } from './semantic-types'
import {
  classifySymbolReference,
  extractDirectPairReferenceName,
  isExpr,
  isScalarBuiltinVisibleInScope,
  isScopeWithinKind,
  resolveVisibleConstBinding,
  resolveVisibleDefPointBinding,
  SemanticSymbolModel
} from './semantic-symbol-model'

type SymbolExpectation = 'scalar' | 'pair' | 'point'

export function validateSemanticProgram(
  bound: BoundProgram,
  diagnostics: SemanticDiagnostic[],
  model: SemanticSymbolModel
): void {
  validateMixedDeclarationUsage(bound, diagnostics, model.fallbackFilePath)
  validateSymbolUsages(bound, diagnostics, model)
  validatePairContexts(bound, diagnostics, model)
  validatePointContexts(bound, diagnostics, model)
}

function validateMixedDeclarationUsage(
  bound: BoundProgram,
  diagnostics: SemanticDiagnostic[],
  fallbackFilePath: string
): void {
  const declarationsByScopeAndName = new Map<string, typeof bound.declarations>()
  const reported = new Set<string>()

  for (const declaration of bound.declarations) {
    const key = `${declaration.scopeId}:${declaration.name}`
    const existing = declarationsByScopeAndName.get(key)
    if (existing) {
      existing.push(declaration)
      continue
    }
    declarationsByScopeAndName.set(key, [declaration])
  }

  for (const declarations of declarationsByScopeAndName.values()) {
    if (declarations.length < 2) continue
    const reference = declarations[0]
    const nodeKinds = new Set(declarations.map((declaration) => declaration.nodeKind))

    if (nodeKinds.has('let') && nodeKinds.has('const')) {
      const key = `scalar:${reference.scopeId}:${reference.name}`
      if (!reported.has(key)) {
        reported.add(key)
        diagnostics.push(
          createSemanticDiagnostic(
            'S008',
            `Incompatible mixed legacy/declarative usage for symbol "${reference.name}" in the same scope: do not combine "let" and "const" declarations.`,
            reference.pos,
            fallbackFilePath
          )
        )
      }
    }

    if (nodeKinds.has('defpt') && (nodeKinds.has('anchor') || nodeKinds.has('letpt'))) {
      const key = `point:${reference.scopeId}:${reference.name}`
      if (!reported.has(key)) {
        reported.add(key)
        diagnostics.push(
          createSemanticDiagnostic(
            'S008',
            `Incompatible mixed legacy/declarative usage for point symbol "${reference.name}" in the same scope: do not combine "defpt" with legacy "anchor"/"letpt" declarations.`,
            reference.pos,
            fallbackFilePath
          )
        )
      }
    }
  }
}

function validateSymbolUsages(
  bound: BoundProgram,
  diagnostics: SemanticDiagnostic[],
  model: SemanticSymbolModel
): void {
  const fallbackFilePath = model.fallbackFilePath
  const reportedDiagnostics = new Set<string>()
  const runtimeScalarDeclarationsByScope = collectRuntimeDeclarationsByScope(bound, 'scalar')
  const runtimePointDeclarationsByScope = collectRuntimeDeclarationsByScope(bound, 'point')
  const seenRuntimeScalarDeclarationsByScope = new Map<number, Set<string>>()
  const seenRuntimePointDeclarationsByScope = new Map<number, Set<string>>()

  const markRuntimeDeclarationSeen = (
    target: Map<number, Set<string>>,
    scopeId: number,
    name: string
  ): void => {
    let scoped = target.get(scopeId)
    if (!scoped) {
      scoped = new Set<string>()
      target.set(scopeId, scoped)
    }
    scoped.add(name)
  }

  const hasRuntimeDeclarationInScopeChain = (
    name: string,
    scopeId: number,
    declarationsByScope: Map<number, Set<string>>
  ): boolean => {
    let currentScopeId: number | null = scopeId
    while (currentScopeId !== null) {
      if (declarationsByScope.get(currentScopeId)?.has(name)) return true
      currentScopeId = model.scopeById.get(currentScopeId)?.parentId ?? null
    }
    return false
  }

  const isRuntimeDeclarationVisibleNow = (
    name: string,
    scopeId: number,
    seenByScope: Map<number, Set<string>>
  ): boolean => {
    let currentScopeId: number | null = scopeId
    while (currentScopeId !== null) {
      if (seenByScope.get(currentScopeId)?.has(name)) return true
      currentScopeId = model.scopeById.get(currentScopeId)?.parentId ?? null
    }
    return false
  }

  const reportSymbolDiagnostic = (
    code: 'S001' | 'S002' | 'S007' | 'S011',
    message: string,
    pos: ASTNode['pos']
  ): void => {
    const key = `${code}:${pos.filePath ?? fallbackFilePath}:${pos.line}:${pos.column}:${message}`
    if (reportedDiagnostics.has(key)) return
    reportedDiagnostics.add(key)
    diagnostics.push(createSemanticDiagnostic(code, message, pos, fallbackFilePath))
  }

  const validateReference = (
    rawName: string,
    expectation: SymbolExpectation,
    scopeId: number,
    symbolPos: ASTNode['pos'] | undefined,
    fallbackPos: ASTNode['pos'],
    contextLabel: string
  ): void => {
    const classification = classifySymbolReference(rawName, expectation, scopeId, model)
    const pos = symbolPos ?? fallbackPos
    if (classification.status === 'valid') {
      // Order-sensitive legacy declarations are only checked in immediately-executed scopes.
      const inDeferredScope = isScopeWithinKind(scopeId, 'group', model.scopeById) || isScopeWithinKind(scopeId, 'frame', model.scopeById)
      if (inDeferredScope) return

      if (expectation === 'scalar') {
        if (isScalarBuiltinVisibleInScope(rawName, scopeId, model.scopeById)) return
        if (resolveVisibleConstBinding(rawName, scopeId, model)) return

        if (
          hasRuntimeDeclarationInScopeChain(rawName, scopeId, runtimeScalarDeclarationsByScope) &&
          !isRuntimeDeclarationVisibleNow(rawName, scopeId, seenRuntimeScalarDeclarationsByScope)
        ) {
          reportSymbolDiagnostic(
            'S011',
            `Symbol $${rawName} is used before declaration in ${contextLabel}. Legacy "let" declarations are order-dependent.`,
            pos
          )
        }
        return
      }

      if (expectation === 'point') {
        if (resolveVisibleDefPointBinding(rawName, scopeId, model)) return

        if (
          hasRuntimeDeclarationInScopeChain(rawName, scopeId, runtimePointDeclarationsByScope) &&
          !isRuntimeDeclarationVisibleNow(rawName, scopeId, seenRuntimePointDeclarationsByScope)
        ) {
          reportSymbolDiagnostic(
            'S011',
            `Point symbol "${rawName}" is used before declaration in ${contextLabel}. Legacy "anchor"/"letpt" declarations are order-dependent; use "defpt" for forward references.`,
            pos
          )
        }
      }
      return
    }

    if (classification.status === 'unknown') {
      const qualifier = expectation === 'pair'
        ? 'pair symbol'
        : expectation === 'point'
          ? 'point symbol'
          : 'symbol'
      const sourceLabel = expectation === 'pair' ? `"${rawName}"` : `$${rawName}`
      reportSymbolDiagnostic(
        'S001',
        `Unknown ${qualifier} ${sourceLabel} in ${contextLabel}.${classification.hint ? ` ${classification.hint}` : ''}`,
        pos
      )
      return
    }

    if (classification.status === 'out-of-scope') {
      const sourceLabel = expectation === 'pair' ? `"${rawName}"` : `$${rawName}`
      const declarationLocation = formatSourceLocation(classification.declaration.pos, fallbackFilePath)
      reportSymbolDiagnostic(
        'S007',
        `Symbol ${sourceLabel} is not visible in ${contextLabel}. It is declared in a different scope at ${declarationLocation}.`,
        pos
      )
      return
    }

    const sourceLabel = expectation === 'pair' ? `"${rawName}"` : `$${rawName}`
    const expectedLabel = expectation === 'pair'
      ? 'pair symbol'
      : expectation === 'point'
        ? 'point symbol'
        : 'scalar symbol'
    reportSymbolDiagnostic(
      'S002',
      `Symbol kind mismatch in ${contextLabel}: ${sourceLabel} resolves to ${classification.actualKind} symbol "${rawName}", but ${expectedLabel} is required.`,
      pos
    )
  }

  const validateScalarExpr = (expr: Expr, scopeId: number, contextLabel: string, fallbackPos: ASTNode['pos']): void => {
    switch (expr.kind) {
      case 'literal':
        return
      case 'var':
        validateReference(expr.name, 'scalar', scopeId, expr.pos, fallbackPos, contextLabel)
        return
      case 'pairVar':
        validateReference(expr.name, 'scalar', scopeId, expr.pos, fallbackPos, contextLabel)
        return
      case 'unary':
        validateScalarExpr(expr.expr, scopeId, contextLabel, fallbackPos)
        return
      case 'binary':
        validateScalarExpr(expr.left, scopeId, contextLabel, fallbackPos)
        validateScalarExpr(expr.right, scopeId, contextLabel, fallbackPos)
        return
      case 'call':
        for (const arg of expr.args) {
          validateScalarExpr(arg, scopeId, contextLabel, fallbackPos)
        }
        return
    }
  }

  const validateScalarValue = (
    value: ScalarValue | undefined,
    scopeId: number,
    contextLabel: string,
    fallbackPos: ASTNode['pos']
  ): void => {
    if (value === undefined || typeof value === 'number') return
    validateScalarExpr(value, scopeId, contextLabel, fallbackPos)
  }

  const validatePoint = (point: Point, scopeId: number, contextLabel: string, fallbackPos: ASTNode['pos']): void => {
    validateScalarValue(point.x, scopeId, `${contextLabel} x`, fallbackPos)
    validateScalarValue(point.y, scopeId, `${contextLabel} y`, fallbackPos)
    if (point.anchorName) {
      validateReference(point.anchorName, 'point', scopeId, point.anchorPos, fallbackPos, `${contextLabel} anchor`)
    }
  }

  const validateCoordinate = (
    x: ScalarValue,
    y: ScalarValue,
    anchorName: string | undefined,
    scopeId: number,
    contextLabel: string,
    fallbackPos: ASTNode['pos']
  ): void => {
    validateScalarValue(x, scopeId, `${contextLabel} x`, fallbackPos)
    validateScalarValue(y, scopeId, `${contextLabel} y`, fallbackPos)
    if (anchorName) {
      validateReference(anchorName, 'point', scopeId, undefined, fallbackPos, `${contextLabel} anchor`)
    }
  }

  const validatePairUsageSymbols = (
    xValue: ScalarValue,
    yValue: ScalarValue,
    scopeId: number,
    contextLabel: string,
    fallbackPos: ASTNode['pos']
  ): void => {
    const pairReferenceName = extractDirectPairReferenceName(xValue, yValue)
    if (pairReferenceName) {
      const symbolPos = isExpr(xValue) && xValue.kind === 'pairVar' ? xValue.pos : undefined
      validateReference(pairReferenceName, 'pair', scopeId, symbolPos, fallbackPos, contextLabel)
      return
    }

    validateScalarValue(xValue, scopeId, `${contextLabel} x`, fallbackPos)
    validateScalarValue(yValue, scopeId, `${contextLabel} y`, fallbackPos)
  }

  const visit = (node: ASTNode): void => {
    const scopeId = bound.nodeScopes.get(node) ?? 0

    switch (node.kind) {
      case 'let':
        validateScalarExpr(node.value, scopeId, `let "${node.name}"`, node.pos)
        markRuntimeDeclarationSeen(seenRuntimeScalarDeclarationsByScope, scopeId, node.name)
        return
      case 'const':
        validateScalarExpr(node.value, scopeId, `const "${node.name}"`, node.pos)
        return
      case 'letpair':
      case 'letvec':
      case 'letsz':
        validatePairUsageSymbols(node.width, node.height, scopeId, `${node.kind} "${node.name}"`, node.pos)
        return
      case 'anchor':
        validateScalarValue(node.x, scopeId, 'anchor x', node.pos)
        validateScalarValue(node.y, scopeId, 'anchor y', node.pos)
        markRuntimeDeclarationSeen(seenRuntimePointDeclarationsByScope, scopeId, node.name)
        return
      case 'box':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, `box "${node.name}"`, node.pos)
        validatePairUsageSymbols(node.width, node.height, scopeId, `box "${node.name}" size`, node.pos)
        return
      case 'letpt':
        validatePoint(node.point, scopeId, `${node.kind} "${node.name}"`, node.pos)
        markRuntimeDeclarationSeen(seenRuntimePointDeclarationsByScope, scopeId, node.name)
        return
      case 'defpt':
        validatePoint(node.point, scopeId, `${node.kind} "${node.name}"`, node.pos)
        return
      case 'cursor':
        validatePoint(node.point, scopeId, 'cursor', node.pos)
        return
      case 'pixel':
      case 'polygon':
      case 'opoly':
      case 'fill':
        for (const point of node.points) {
          validatePoint(point, scopeId, node.kind, node.pos)
        }
        return
      case 'stamp':
        for (const point of node.points) {
          validatePoint(point, scopeId, 'stamp', node.pos)
        }
        validateScalarValue(node.opacity, scopeId, 'stamp opacity', node.pos)
        return
      case 'rect':
      case 'orect':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, node.kind, node.pos)
        validatePairUsageSymbols(node.width, node.height, scopeId, `${node.kind} size`, node.pos)
        return
      case 'line':
      case 'oline':
        validateCoordinate(node.x1, node.y1, node.anchorName1, scopeId, `${node.kind} start`, node.pos)
        validateCoordinate(node.x2, node.y2, node.anchorName2, scopeId, `${node.kind} end`, node.pos)
        return
      case 'circle':
      case 'ocirc':
      case 'glow':
        validateCoordinate(node.cx, node.cy, node.anchorName, scopeId, node.kind, node.pos)
        validateScalarValue(node.radius, scopeId, `${node.kind} radius`, node.pos)
        return
      case 'arc':
        validateCoordinate(node.cx, node.cy, node.anchorName, scopeId, 'arc', node.pos)
        validateScalarValue(node.radius, scopeId, 'arc radius', node.pos)
        validateScalarValue(node.startAngle, scopeId, 'arc start angle', node.pos)
        validateScalarValue(node.endAngle, scopeId, 'arc end angle', node.pos)
        return
      case 'ellipse':
      case 'oellipse':
        validateCoordinate(node.cx, node.cy, node.anchorName, scopeId, node.kind, node.pos)
        validatePairUsageSymbols(node.rx, node.ry, scopeId, `${node.kind} radii`, node.pos)
        return
      case 'tile':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, 'tile', node.pos)
        validatePairUsageSymbols(node.width, node.height, scopeId, 'tile size', node.pos)
        if (node.stepX !== undefined && node.stepY !== undefined) {
          validatePairUsageSymbols(node.stepX, node.stepY, scopeId, 'tile step', node.pos)
        } else {
          validateScalarValue(node.stepX, scopeId, 'tile step x', node.pos)
          validateScalarValue(node.stepY, scopeId, 'tile step y', node.pos)
        }
        return
      case 'map':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, 'map', node.pos)
        return
      case 'text':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, 'text', node.pos)
        validateScalarValue(node.tracking, scopeId, 'text tracking', node.pos)
        validateScalarValue(node.lineHeight, scopeId, 'text lineHeight', node.pos)
        validateScalarValue(node.wrap, scopeId, 'text wrap', node.pos)
        return
      case 'scatter':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, 'scatter', node.pos)
        validatePairUsageSymbols(node.width, node.height, scopeId, 'scatter size', node.pos)
        validateScalarValue(node.count, scopeId, 'scatter count', node.pos)
        validateScalarValue(node.seed, scopeId, 'scatter seed', node.pos)
        return
      case 'emit':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, 'emit', node.pos)
        validateScalarValue(node.count, scopeId, 'emit count', node.pos)
        validatePairUsageSymbols(node.spreadWidth, node.spreadHeight, scopeId, 'emit spread', node.pos)
        validatePairUsageSymbols(node.driftX, node.driftY, scopeId, 'emit drift', node.pos)
        validateScalarValue(node.driftTime, scopeId, 'emit drift time', node.pos)
        validatePairUsageSymbols(node.velX, node.velY, scopeId, 'emit velocity', node.pos)
        validatePairUsageSymbols(node.jitterX, node.jitterY, scopeId, 'emit jitter', node.pos)
        validateScalarValue(node.activeStart, scopeId, 'emit active start', node.pos)
        validateScalarValue(node.activeEnd, scopeId, 'emit active end', node.pos)
        validateScalarValue(node.life, scopeId, 'emit life', node.pos)
        validateScalarValue(node.loop, scopeId, 'emit loop', node.pos)
        validateScalarValue(node.seed, scopeId, 'emit seed', node.pos)
        return
      case 'dither':
        validateCoordinate(node.x, node.y, node.anchorName, scopeId, 'dither', node.pos)
        validatePairUsageSymbols(node.width, node.height, scopeId, 'dither size', node.pos)
        validateScalarValue(node.seed, scopeId, 'dither seed', node.pos)
        return
      case 'repeat':
        validateScalarValue(node.count, scopeId, 'repeat count', node.pos)
        validatePairUsageSymbols(node.dx, node.dy, scopeId, 'repeat step', node.pos)
        for (const child of node.body) visit(child)
        return
      case 'offset':
        validatePairUsageSymbols(node.dx, node.dy, scopeId, 'offset pair', node.pos)
        return
      case 'fade':
        validateScalarValue(node.factor, scopeId, 'fade factor', node.pos)
        return
      case 'group':
        if (node.pivot) {
          validatePairUsageSymbols(node.pivot.x, node.pivot.y, scopeId, `group "${node.name}" pivot`, node.pos)
        }
        for (const child of node.body) visit(child)
        return
      case 'bitmap':
        if (node.pivot) {
          validatePairUsageSymbols(node.pivot.x, node.pivot.y, scopeId, `bitmap "${node.name}" pivot`, node.pos)
        }
        return
      case 'frame':
        for (const child of node.body) visit(child)
        return
      case 'tileset':
        validateScalarValue(node.seed, scopeId, 'tileset seed', node.pos)
        for (const entry of node.entries) {
          validateScalarValue(entry.weight, scopeId, `tileset "${node.name}" tile weight`, entry.pos)
        }
        return
      case 'canvas':
      case 'palette':
      case 'include':
      case 'mirror':
      case 'font':
      case 'color':
      case 'clear':
      case 'layer':
      case 'push':
      case 'pop':
      case 'tilemap':
        return
    }
  }

  for (const statement of bound.program.statements) {
    visit(statement)
  }
}

function collectRuntimeDeclarationsByScope(
  bound: BoundProgram,
  kind: 'scalar' | 'point'
): Map<number, Set<string>> {
  const runtimeNodeKinds = kind === 'scalar' ? new Set<ASTNode['kind']>(['let']) : new Set<ASTNode['kind']>(['anchor', 'letpt'])
  const declarationsByScope = new Map<number, Set<string>>()

  for (const declaration of bound.declarations) {
    if (!runtimeNodeKinds.has(declaration.nodeKind)) continue
    let scoped = declarationsByScope.get(declaration.scopeId)
    if (!scoped) {
      scoped = new Set<string>()
      declarationsByScope.set(declaration.scopeId, scoped)
    }
    scoped.add(declaration.name)
  }

  return declarationsByScope
}

function validatePairContexts(
  bound: BoundProgram,
  diagnostics: SemanticDiagnostic[],
  model: SemanticSymbolModel
): void {
  const fallbackFilePath = model.fallbackFilePath
  const reportedInvalidPairs = new Set<string>()
  const reportedInvalidRepeatSteps = new Set<string>()

  const reportInvalidPair = (
    contextLabel: string,
    kind: 'kind-mismatch' | 'invalid',
    pos: ASTNode['pos']
  ): void => {
    const key = `${pos.filePath ?? fallbackFilePath}:${pos.line}:${pos.column}:${contextLabel}:${kind}`
    if (reportedInvalidPairs.has(key)) return
    reportedInvalidPairs.add(key)

    const message = kind === 'kind-mismatch'
      ? `Invalid pair expression in ${contextLabel}. Pair components must be scalar expressions or a direct pair symbol reference.`
      : `Invalid pair expression in ${contextLabel}. Expected scalar pair components or a direct pair symbol reference.`
    diagnostics.push(createSemanticDiagnostic('S005', message, pos, fallbackFilePath))
  }

  const reportInvalidRepeatStep = (
    kind: 'kind-mismatch' | 'invalid',
    pos: ASTNode['pos']
  ): void => {
    const key = `${pos.filePath ?? fallbackFilePath}:${pos.line}:${pos.column}:${kind}`
    if (reportedInvalidRepeatSteps.has(key)) return
    reportedInvalidRepeatSteps.add(key)

    const message = kind === 'kind-mismatch'
      ? 'Invalid repeat step form. The "step" value must resolve to scalar pair components or a direct pair symbol reference.'
      : 'Invalid repeat step form. Expected a repeat step pair expression.'
    diagnostics.push(createSemanticDiagnostic('S009', message, pos, fallbackFilePath))
  }

  const validatePair = (
    contextLabel: string,
    xValue: ScalarValue | undefined,
    yValue: ScalarValue | undefined,
    scopeId: number,
    pos: ASTNode['pos']
  ): { status: 'valid' } | { status: 'invalid' | 'kind-mismatch'; pos: ASTNode['pos'] } => {
    const attributionPos = pairAttributionPos(xValue, yValue, pos)
    if (xValue === undefined || yValue === undefined) {
      reportInvalidPair(contextLabel, 'invalid', attributionPos)
      return { status: 'invalid', pos: attributionPos }
    }

    const directPairName = extractDirectPairReferenceName(xValue, yValue)
    if (directPairName) {
      const classification = classifySymbolReference(directPairName, 'pair', scopeId, model)
      if (classification.status === 'valid') return { status: 'valid' }
      const invalidKind = classification.status === 'mismatch' ? 'kind-mismatch' : 'invalid'
      reportInvalidPair(contextLabel, invalidKind, attributionPos)
      return { status: invalidKind, pos: attributionPos }
    }

    const xValidation = validatePairComponent(xValue, scopeId, model)
    const yValidation = validatePairComponent(yValue, scopeId, model)
    if (xValidation === 'valid' && yValidation === 'valid') return { status: 'valid' }

    const invalidKind = xValidation === 'kind-mismatch' || yValidation === 'kind-mismatch'
      ? 'kind-mismatch'
      : 'invalid'
    reportInvalidPair(contextLabel, invalidKind, attributionPos)
    return { status: invalidKind, pos: attributionPos }
  }

  const visit = (node: ASTNode): void => {
    const scopeId = bound.nodeScopes.get(node) ?? 0
    switch (node.kind) {
      case 'letpair':
      case 'letvec':
      case 'letsz':
        validatePair(`${node.kind} "${node.name}"`, node.width, node.height, scopeId, node.pos)
        return
      case 'rect':
        validatePair('rect size', node.width, node.height, scopeId, node.pos)
        return
      case 'orect':
        validatePair('orect size', node.width, node.height, scopeId, node.pos)
        return
      case 'ellipse':
        validatePair('ellipse radii', node.rx, node.ry, scopeId, node.pos)
        return
      case 'oellipse':
        validatePair('oellipse radii', node.rx, node.ry, scopeId, node.pos)
        return
      case 'box':
        validatePair(`box "${node.name}" size`, node.width, node.height, scopeId, node.pos)
        return
      case 'tile':
        validatePair('tile region size', node.width, node.height, scopeId, node.pos)
        if (node.stepX !== undefined || node.stepY !== undefined) {
          validatePair('tile step size', node.stepX, node.stepY, scopeId, node.pos)
        }
        return
      case 'scatter':
        validatePair('scatter region size', node.width, node.height, scopeId, node.pos)
        return
      case 'emit':
        validatePair('emit spread pair', node.spreadWidth, node.spreadHeight, scopeId, node.pos)
        validatePair('emit drift pair', node.driftX, node.driftY, scopeId, node.pos)
        validatePair('emit velocity pair', node.velX, node.velY, scopeId, node.pos)
        validatePair('emit jitter pair', node.jitterX, node.jitterY, scopeId, node.pos)
        return
      case 'dither':
        validatePair('dither region size', node.width, node.height, scopeId, node.pos)
        return
      case 'repeat':
        {
          const pairValidation = validatePair('repeat offsets', node.dx, node.dy, scopeId, node.pos)
          if (node.offsetSyntax === 'step' && pairValidation.status !== 'valid') {
            reportInvalidRepeatStep(pairValidation.status, pairValidation.pos)
          }
        }
        for (const child of node.body) visit(child)
        return
      case 'offset':
        validatePair('offset pair', node.dx, node.dy, scopeId, node.pos)
        return
      case 'group':
        if (node.pivot) {
          validatePair(`group "${node.name}" pivot`, node.pivot.x, node.pivot.y, scopeId, node.pos)
        }
        for (const child of node.body) visit(child)
        return
      case 'bitmap':
        if (node.pivot) {
          validatePair(`bitmap "${node.name}" pivot`, node.pivot.x, node.pivot.y, scopeId, node.pos)
        }
        return
      case 'frame':
        for (const child of node.body) visit(child)
        return
      default:
        return
    }
  }

  for (const statement of bound.program.statements) {
    visit(statement)
  }
}

function validatePointContexts(
  bound: BoundProgram,
  diagnostics: SemanticDiagnostic[],
  model: SemanticSymbolModel
): void {
  const fallbackFilePath = model.fallbackFilePath
  const reportedInvalidPoints = new Set<string>()

  const reportInvalidPoint = (
    contextLabel: string,
    kind: 'kind-mismatch' | 'invalid',
    pos: ASTNode['pos']
  ): void => {
    const key = `${pos.filePath ?? fallbackFilePath}:${pos.line}:${pos.column}:${contextLabel}:${kind}`
    if (reportedInvalidPoints.has(key)) return
    reportedInvalidPoints.add(key)

    const message = kind === 'kind-mismatch'
      ? `Invalid point expression in ${contextLabel}. Point expressions must resolve to point symbols with scalar offsets.`
      : `Invalid point expression in ${contextLabel}. Expected a point symbol reference or coordinate expression with scalar offsets.`
    diagnostics.push(createSemanticDiagnostic('S006', message, pos, fallbackFilePath))
  }

  const validatePointExpression = (
    contextLabel: string,
    point: Point,
    scopeId: number,
    fallbackPos: ASTNode['pos']
  ): void => {
    const anchorClassification = point.anchorName
      ? classifySymbolReference(point.anchorName, 'point', scopeId, model)
      : null
    const xValidation = validatePairComponent(point.x, scopeId, model)
    const yValidation = validatePairComponent(point.y, scopeId, model)

    if (
      (anchorClassification === null || anchorClassification.status === 'valid') &&
      xValidation === 'valid' &&
      yValidation === 'valid'
    ) {
      return
    }

    const kind: 'kind-mismatch' | 'invalid' =
      (anchorClassification?.status === 'mismatch' ||
      xValidation === 'kind-mismatch' ||
      yValidation === 'kind-mismatch')
        ? 'kind-mismatch'
        : 'invalid'
    reportInvalidPoint(contextLabel, kind, pointAttributionPos(point, fallbackPos))
  }

  const validateCoordinateExpression = (
    contextLabel: string,
    x: ScalarValue,
    y: ScalarValue,
    isCenter: boolean,
    isRelativeX: boolean,
    isRelativeY: boolean,
    anchorName: string | undefined,
    scopeId: number,
    fallbackPos: ASTNode['pos']
  ): void => {
    validatePointExpression(
      contextLabel,
      { x, y, isCenter, isRelativeX, isRelativeY, anchorName },
      scopeId,
      fallbackPos
    )
  }

  const visit = (node: ASTNode): void => {
    const scopeId = bound.nodeScopes.get(node) ?? 0
    switch (node.kind) {
      case 'letpt':
      case 'defpt':
      case 'cursor':
        validatePointExpression(node.kind, node.point, scopeId, node.pos)
        return
      case 'pixel':
      case 'polygon':
      case 'opoly':
      case 'fill':
        for (const point of node.points) {
          validatePointExpression(node.kind, point, scopeId, node.pos)
        }
        return
      case 'stamp':
        for (const point of node.points) {
          validatePointExpression('stamp', point, scopeId, node.pos)
        }
        return
      case 'rect':
      case 'orect':
        validateCoordinateExpression(node.kind, node.x, node.y, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName, scopeId, node.pos)
        return
      case 'line':
      case 'oline':
        validateCoordinateExpression(`${node.kind} start`, node.x1, node.y1, node.isCenter1, node.isRelativeX1, node.isRelativeY1, node.anchorName1, scopeId, node.pos)
        validateCoordinateExpression(`${node.kind} end`, node.x2, node.y2, node.isCenter2, node.isRelativeX2, node.isRelativeY2, node.anchorName2, scopeId, node.pos)
        return
      case 'circle':
      case 'ocirc':
      case 'arc':
      case 'glow':
      case 'ellipse':
      case 'oellipse':
        validateCoordinateExpression(node.kind, node.cx, node.cy, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName, scopeId, node.pos)
        return
      case 'tile':
      case 'map':
      case 'text':
      case 'scatter':
      case 'emit':
      case 'dither':
        validateCoordinateExpression(node.kind, node.x, node.y, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName, scopeId, node.pos)
        return
      case 'group':
      case 'repeat':
      case 'frame':
        for (const child of node.body) visit(child)
        return
      default:
        return
    }
  }

  for (const statement of bound.program.statements) {
    visit(statement)
  }
}

function validatePairComponent(
  value: ScalarValue,
  scopeId: number,
  model: SemanticSymbolModel
): 'valid' | 'invalid' | 'kind-mismatch' {
  if (typeof value === 'number') return 'valid'
  if (!isExpr(value)) return 'invalid'

  return validateScalarExprForPairContext(value, scopeId, model)
}

function validateScalarExprForPairContext(
  expr: Expr,
  scopeId: number,
  model: SemanticSymbolModel
): 'valid' | 'invalid' | 'kind-mismatch' {
  switch (expr.kind) {
    case 'literal':
      return 'valid'
    case 'pairVar':
      return 'kind-mismatch'
    case 'var': {
      const classification = classifySymbolReference(expr.name, 'scalar', scopeId, model)
      if (classification.status === 'valid') return 'valid'
      if (classification.status === 'mismatch') return 'kind-mismatch'
      return 'invalid'
    }
    case 'unary':
      return validateScalarExprForPairContext(expr.expr, scopeId, model)
    case 'binary': {
      const left = validateScalarExprForPairContext(expr.left, scopeId, model)
      const right = validateScalarExprForPairContext(expr.right, scopeId, model)
      if (left === 'kind-mismatch' || right === 'kind-mismatch') return 'kind-mismatch'
      if (left === 'invalid' || right === 'invalid') return 'invalid'
      return 'valid'
    }
    case 'call': {
      let sawInvalid = false
      for (const arg of expr.args) {
        const result = validateScalarExprForPairContext(arg, scopeId, model)
        if (result === 'kind-mismatch') return 'kind-mismatch'
        if (result === 'invalid') sawInvalid = true
      }
      return sawInvalid ? 'invalid' : 'valid'
    }
  }
}

function formatSourceLocation(pos: ASTNode['pos'], fallbackFilePath: string): string {
  const filePath = pos.filePath ?? fallbackFilePath
  return `${filePath}:${pos.line}:${pos.column}`
}

function pairAttributionPos(
  width: ScalarValue | undefined,
  height: ScalarValue | undefined,
  fallbackPos: ASTNode['pos']
): ASTNode['pos'] {
  const xPos = expressionAttributionPos(width)
  if (xPos) return xPos
  const yPos = expressionAttributionPos(height)
  if (yPos) return yPos
  return fallbackPos
}

function pointAttributionPos(point: Point, fallbackPos: ASTNode['pos']): ASTNode['pos'] {
  if (point.anchorPos) return point.anchorPos
  const xPos = expressionAttributionPos(point.x)
  if (xPos) return xPos
  const yPos = expressionAttributionPos(point.y)
  if (yPos) return yPos
  return fallbackPos
}

function expressionAttributionPos(value: ScalarValue | undefined): ASTNode['pos'] | undefined {
  if (value === undefined || typeof value === 'number' || !isExpr(value)) return undefined
  return findExpressionPosition(value)
}

function findExpressionPosition(expr: Expr): ASTNode['pos'] | undefined {
  switch (expr.kind) {
    case 'var':
    case 'pairVar':
      return expr.pos
    case 'unary':
      return findExpressionPosition(expr.expr)
    case 'binary':
      return findExpressionPosition(expr.left) ?? findExpressionPosition(expr.right)
    case 'call':
      for (const arg of expr.args) {
        const pos = findExpressionPosition(arg)
        if (pos) return pos
      }
      return undefined
    case 'literal':
      return undefined
  }
}
