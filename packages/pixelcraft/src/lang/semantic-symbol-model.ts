import { ASTNode, ConstNode, DefPointNode, Expr, LetPairNode, ScalarValue } from './ast'
import { createSemanticDiagnostic } from './semantic-diagnostics'
import {
  BoundProgram,
  SemanticDeclaration,
  SemanticDiagnostic,
  SemanticScope
} from './semantic-types'

export interface ConstBinding {
  node: ConstNode
  scopeId: number
  deps: Set<ConstBinding>
}

export interface DefPointBinding {
  node: DefPointNode
  scopeId: number
  deps: Set<DefPointBinding>
}

export interface PairBinding {
  node: LetPairNode
  scopeId: number
  deps: Set<PairBinding>
}

export interface SemanticSymbolModel {
  fallbackFilePath: string
  scopeById: Map<number, SemanticScope>
  scalarDeclarationsByScope: Map<number, Map<string, SemanticDeclaration>>
  pairDeclarationsByScope: Map<number, Map<string, SemanticDeclaration>>
  pointDeclarationsByScope: Map<number, Map<string, SemanticDeclaration>>
  constByScope: Map<number, Map<string, ConstBinding>>
  pairsByScope: Map<number, Map<string, PairBinding>>
  defPointsByScope: Map<number, Map<string, DefPointBinding>>
  constBindings: ConstBinding[]
  pairBindings: PairBinding[]
  defPointBindings: DefPointBinding[]
  constCycleBindings: Set<ConstBinding>
  pairCycleBindings: Set<PairBinding>
  defPointCycleBindings: Set<DefPointBinding>
}

export type SymbolExpectation = 'scalar' | 'pair' | 'point'

export type SymbolClassification =
  | { status: 'valid' }
  | { status: 'unknown'; hint?: string }
  | { status: 'out-of-scope'; declaration: SemanticDeclaration }
  | { status: 'mismatch'; actualKind: 'scalar' | 'pair' | 'point' }

const CANVAS_BUILTIN_SCALARS = new Set(['width', 'height', 'centerX', 'centerY'])
const FRAME_BUILTIN_SCALARS = new Set(['frame', 'frameCount', 'frameNumber'])
const REPEAT_BUILTIN_SCALARS = new Set(['i'])
const EXPRESSION_KINDS = new Set(['literal', 'var', 'pairVar', 'unary', 'binary', 'call'])

export function buildSemanticSymbolModel(
  bound: BoundProgram,
  diagnostics: SemanticDiagnostic[] | null = null
): SemanticSymbolModel {
  const fallbackFilePath = defaultFilePath(bound)
  const scopeById = new Map<number, SemanticScope>(bound.scopes.map((scope) => [scope.id, scope]))
  const scalarDeclarationsByScope = collectDeclarationsByScope(bound.declarations, 'scalar')
  const pairDeclarationsByScope = collectDeclarationsByScope(bound.declarations, 'pair')
  const pointDeclarationsByScope = collectDeclarationsByScope(bound.declarations, 'point')

  const constSources = collectConstBindings(bound)
  const constByScope = new Map<number, Map<string, ConstBinding>>()
  const constBindings: ConstBinding[] = []

  for (const binding of constSources) {
    let scopeBindings = constByScope.get(binding.scopeId)
    if (!scopeBindings) {
      scopeBindings = new Map()
      constByScope.set(binding.scopeId, scopeBindings)
    }
    if (scopeBindings.has(binding.node.name)) {
      maybePushDiagnostic(
        diagnostics,
        createSemanticDiagnostic(
          'S003',
          `Duplicate const declaration "${binding.node.name}" in the same scope.`,
          binding.node.pos,
          fallbackFilePath
        )
      )
      continue
    }
    scopeBindings.set(binding.node.name, binding)
    constBindings.push(binding)
  }

  const pairSources = collectPairBindings(bound)
  const pairsByScope = new Map<number, Map<string, PairBinding>>()
  const pairBindings: PairBinding[] = []

  for (const binding of pairSources) {
    let scopeBindings = pairsByScope.get(binding.scopeId)
    if (!scopeBindings) {
      scopeBindings = new Map()
      pairsByScope.set(binding.scopeId, scopeBindings)
    }
    if (scopeBindings.has(binding.node.name)) {
      maybePushDiagnostic(
        diagnostics,
        createSemanticDiagnostic(
          'S003',
          `Duplicate pair declaration "${binding.node.name}" in the same scope.`,
          binding.node.pos,
          fallbackFilePath
        )
      )
      continue
    }
    scopeBindings.set(binding.node.name, binding)
    pairBindings.push(binding)
  }

  const defPointSources = collectDefPointBindings(bound)
  const defPointsByScope = new Map<number, Map<string, DefPointBinding>>()
  const defPointBindings: DefPointBinding[] = []

  for (const binding of defPointSources) {
    let scopeBindings = defPointsByScope.get(binding.scopeId)
    if (!scopeBindings) {
      scopeBindings = new Map()
      defPointsByScope.set(binding.scopeId, scopeBindings)
    }
    if (scopeBindings.has(binding.node.name)) {
      maybePushDiagnostic(
        diagnostics,
        createSemanticDiagnostic(
          'S003',
          `Duplicate defpt declaration "${binding.node.name}" in the same scope.`,
          binding.node.pos,
          fallbackFilePath
        )
      )
      continue
    }
    scopeBindings.set(binding.node.name, binding)
    defPointBindings.push(binding)
  }

  for (const binding of constBindings) {
    for (const name of collectReferencedVariableNames(binding.node.value)) {
      const target = lookupVisibleBinding(name, binding.scopeId, constByScope, scopeById)
      if (target) binding.deps.add(target)
    }
  }

  for (const binding of pairBindings) {
    for (const name of collectReferencedPairNames(binding.node.width, binding.node.height)) {
      const target = lookupVisibleBinding(name, binding.scopeId, pairsByScope, scopeById)
      if (target) binding.deps.add(target)
    }
  }

  for (const binding of defPointBindings) {
    const dependencyName = binding.node.point.anchorName
    if (!dependencyName) continue
    const target = lookupVisibleBinding(dependencyName, binding.scopeId, defPointsByScope, scopeById)
    if (target) binding.deps.add(target)
  }

  const constCycleBindings = detectBindingCycles(
    constBindings,
    diagnostics,
    fallbackFilePath,
    'const'
  )
  const pairCycleBindings = detectBindingCycles(
    pairBindings,
    diagnostics,
    fallbackFilePath,
    'pair'
  )
  const defPointCycleBindings = detectBindingCycles(
    defPointBindings,
    diagnostics,
    fallbackFilePath,
    'defpt'
  )

  return {
    fallbackFilePath,
    scopeById,
    scalarDeclarationsByScope,
    pairDeclarationsByScope,
    pointDeclarationsByScope,
    constByScope,
    pairsByScope,
    defPointsByScope,
    constBindings,
    pairBindings,
    defPointBindings,
    constCycleBindings,
    pairCycleBindings,
    defPointCycleBindings
  }
}

export function resolveVisibleConstBinding(
  name: string,
  scopeId: number,
  model: SemanticSymbolModel
): ConstBinding | null {
  return lookupVisibleBinding(name, scopeId, model.constByScope, model.scopeById)
}

export function resolveVisiblePairBinding(
  name: string,
  scopeId: number,
  model: SemanticSymbolModel
): PairBinding | null {
  return lookupVisibleBinding(name, scopeId, model.pairsByScope, model.scopeById)
}

export function resolveVisibleDefPointBinding(
  name: string,
  scopeId: number,
  model: SemanticSymbolModel
): DefPointBinding | null {
  return lookupVisibleBinding(name, scopeId, model.defPointsByScope, model.scopeById)
}

export function classifySymbolReference(
  name: string,
  expectation: SymbolExpectation,
  scopeId: number,
  model: SemanticSymbolModel
): SymbolClassification {
  if (expectation === 'scalar') {
    const scalarMatch = lookupVisibleBinding(
      name,
      scopeId,
      model.scalarDeclarationsByScope,
      model.scopeById
    )
    if (scalarMatch) return { status: 'valid' }
    if (isScalarBuiltinVisibleInScope(name, scopeId, model.scopeById)) return { status: 'valid' }

    const pairMatch = lookupVisibleBinding(
      name,
      scopeId,
      model.pairDeclarationsByScope,
      model.scopeById
    )
    if (pairMatch) return { status: 'mismatch', actualKind: 'pair' }
    const pointMatch = lookupVisibleBinding(
      name,
      scopeId,
      model.pointDeclarationsByScope,
      model.scopeById
    )
    if (pointMatch) return { status: 'mismatch', actualKind: 'point' }
    const outOfScope = findOutOfScopeDeclaration(
      name,
      scopeId,
      model.scalarDeclarationsByScope,
      model.scopeById
    )
    if (outOfScope) return { status: 'out-of-scope', declaration: outOfScope }
    return { status: 'unknown', hint: scalarBuiltinVisibilityHint(name, scopeId, model.scopeById) }
  }

  if (expectation === 'pair') {
    const pairMatch = lookupVisibleBinding(
      name,
      scopeId,
      model.pairDeclarationsByScope,
      model.scopeById
    )
    if (pairMatch) return { status: 'valid' }

    const scalarMatch = lookupVisibleBinding(
      name,
      scopeId,
      model.scalarDeclarationsByScope,
      model.scopeById
    )
    if (scalarMatch) return { status: 'mismatch', actualKind: 'scalar' }
    if (isScalarBuiltinVisibleInScope(name, scopeId, model.scopeById)) {
      return { status: 'mismatch', actualKind: 'scalar' }
    }
    const pointMatch = lookupVisibleBinding(
      name,
      scopeId,
      model.pointDeclarationsByScope,
      model.scopeById
    )
    if (pointMatch) return { status: 'mismatch', actualKind: 'point' }
    const outOfScope = findOutOfScopeDeclaration(
      name,
      scopeId,
      model.pairDeclarationsByScope,
      model.scopeById
    )
    if (outOfScope) return { status: 'out-of-scope', declaration: outOfScope }
    return { status: 'unknown' }
  }

  const pointMatch = lookupVisibleBinding(
    name,
    scopeId,
    model.pointDeclarationsByScope,
    model.scopeById
  )
  if (pointMatch) return { status: 'valid' }

  const scalarMatch = lookupVisibleBinding(
    name,
    scopeId,
    model.scalarDeclarationsByScope,
    model.scopeById
  )
  if (scalarMatch) return { status: 'mismatch', actualKind: 'scalar' }
  if (isScalarBuiltinVisibleInScope(name, scopeId, model.scopeById)) {
    return { status: 'mismatch', actualKind: 'scalar' }
  }
  const pairMatch = lookupVisibleBinding(
    name,
    scopeId,
    model.pairDeclarationsByScope,
    model.scopeById
  )
  if (pairMatch) return { status: 'mismatch', actualKind: 'pair' }
  const outOfScope = findOutOfScopeDeclaration(
    name,
    scopeId,
    model.pointDeclarationsByScope,
    model.scopeById
  )
  if (outOfScope) return { status: 'out-of-scope', declaration: outOfScope }
  return { status: 'unknown' }
}

export function scalarBuiltinVisibilityHint(
  name: string,
  scopeId: number,
  scopeById: Map<number, SemanticScope>
): string | undefined {
  if (FRAME_BUILTIN_SCALARS.has(name) && !isScopeWithinKind(scopeId, 'frame', scopeById)) {
    return 'Frame built-ins are only available inside frame bodies.'
  }
  if (REPEAT_BUILTIN_SCALARS.has(name) && !isScopeWithinKind(scopeId, 'repeat', scopeById)) {
    return 'Repeat built-ins are only available inside repeat bodies.'
  }
  return undefined
}

export function isScalarBuiltinVisibleInScope(
  name: string,
  scopeId: number,
  scopeById: Map<number, SemanticScope>
): boolean {
  if (CANVAS_BUILTIN_SCALARS.has(name)) return true
  if (FRAME_BUILTIN_SCALARS.has(name)) {
    return isScopeWithinKind(scopeId, 'frame', scopeById)
  }
  if (REPEAT_BUILTIN_SCALARS.has(name)) {
    return isScopeWithinKind(scopeId, 'repeat', scopeById)
  }
  return false
}

export function isScopeWithinKind(
  scopeId: number,
  kind: SemanticScope['kind'],
  scopeById: Map<number, SemanticScope>
): boolean {
  let currentScopeId: number | null = scopeId
  while (currentScopeId !== null) {
    const scope = scopeById.get(currentScopeId)
    if (!scope) return false
    if (scope.kind === kind) return true
    currentScopeId = scope.parentId
  }
  return false
}

export function extractDirectPairReferenceName(width: ScalarValue, height: ScalarValue): string | null {
  if (typeof width === 'number' || typeof height === 'number') return null
  if (!isExpr(width) || !isExpr(height)) return null
  if (width.kind !== 'pairVar' || height.kind !== 'pairVar') return null
  if (width.name !== height.name) return null
  return width.name
}

export function isExpr(value: unknown): value is Expr {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'kind' in value &&
      EXPRESSION_KINDS.has(String((value as { kind: string }).kind))
  )
}

export function defaultFilePath(bound: BoundProgram): string {
  for (const statement of bound.program.statements) {
    if (statement.pos.filePath) return statement.pos.filePath
  }
  const rootScope = bound.scopes.find((scope) => scope.id === 0)
  if (rootScope?.ownerPos?.filePath) return rootScope.ownerPos.filePath
  return 'main.pc'
}

function maybePushDiagnostic(
  diagnostics: SemanticDiagnostic[] | null,
  diagnostic: SemanticDiagnostic
): void {
  if (!diagnostics) return
  diagnostics.push(diagnostic)
}

function collectConstBindings(bound: BoundProgram): ConstBinding[] {
  const bindings: ConstBinding[] = []

  const visit = (node: ASTNode): void => {
    if (node.kind === 'const') {
      bindings.push({
        node,
        scopeId: bound.nodeScopes.get(node) ?? 0,
        deps: new Set()
      })
    }
    if (node.kind === 'group' || node.kind === 'repeat' || node.kind === 'frame') {
      for (const child of node.body) visit(child)
    }
  }

  for (const statement of bound.program.statements) visit(statement)
  return bindings
}

function collectDefPointBindings(bound: BoundProgram): DefPointBinding[] {
  const bindings: DefPointBinding[] = []

  const visit = (node: ASTNode): void => {
    if (node.kind === 'defpt') {
      bindings.push({
        node,
        scopeId: bound.nodeScopes.get(node) ?? 0,
        deps: new Set()
      })
    }
    if (node.kind === 'group' || node.kind === 'repeat' || node.kind === 'frame') {
      for (const child of node.body) visit(child)
    }
  }

  for (const statement of bound.program.statements) visit(statement)
  return bindings
}

function collectPairBindings(bound: BoundProgram): PairBinding[] {
  const bindings: PairBinding[] = []

  const visit = (node: ASTNode): void => {
    if (node.kind === 'letpair' || node.kind === 'letvec' || node.kind === 'letsz') {
      bindings.push({
        node,
        scopeId: bound.nodeScopes.get(node) ?? 0,
        deps: new Set()
      })
    }
    if (node.kind === 'group' || node.kind === 'repeat' || node.kind === 'frame') {
      for (const child of node.body) visit(child)
    }
  }

  for (const statement of bound.program.statements) visit(statement)
  return bindings
}

function collectReferencedVariableNames(expr: Expr): Set<string> {
  const names = new Set<string>()

  const visit = (value: Expr): void => {
    switch (value.kind) {
      case 'literal':
        return
      case 'var':
        names.add(value.name)
        return
      case 'pairVar':
        return
      case 'unary':
        visit(value.expr)
        return
      case 'binary':
        visit(value.left)
        visit(value.right)
        return
      case 'call':
        for (const arg of value.args) visit(arg)
        return
    }
  }

  visit(expr)
  return names
}

function collectReferencedPairNames(width: ScalarValue, height: ScalarValue): Set<string> {
  const directPairRef = extractDirectPairReferenceName(width, height)
  if (!directPairRef) return new Set()
  return new Set([directPairRef])
}

function detectBindingCycles<T extends { node: { name: string; pos: ASTNode['pos'] }; deps: Set<T> }>(
  bindings: T[],
  diagnostics: SemanticDiagnostic[] | null,
  fallbackFilePath: string,
  label: 'const' | 'pair' | 'defpt'
): Set<T> {
  const cycleBindings = new Set<T>()
  const state = new Map<T, 0 | 1 | 2>()
  const stack: T[] = []
  const reportedCycles = new Set<string>()

  const reportCycle = (cyclePath: T[]): void => {
    if (!diagnostics || cyclePath.length === 0) return
    const cycleLabel = cyclePath.map((binding) => binding.node.name).join(' -> ')
    if (reportedCycles.has(cycleLabel)) return
    reportedCycles.add(cycleLabel)
    diagnostics.push(
      createSemanticDiagnostic(
        'S004',
        `Circular ${label} dependency: ${cycleLabel}`,
        cyclePath[0].node.pos,
        fallbackFilePath
      )
    )
  }

  const dfs = (binding: T): void => {
    const currentState = state.get(binding) ?? 0
    if (currentState === 2 || currentState === 1) return

    state.set(binding, 1)
    stack.push(binding)

    for (const dep of binding.deps) {
      const depState = state.get(dep) ?? 0
      if (depState === 0) {
        dfs(dep)
        continue
      }
      if (depState === 1) {
        const start = stack.indexOf(dep)
        const cycle = start >= 0 ? [...stack.slice(start), dep] : [dep, binding, dep]
        for (const cycleBinding of cycle) {
          cycleBindings.add(cycleBinding)
        }
        reportCycle(cycle)
      }
    }

    stack.pop()
    state.set(binding, 2)
  }

  for (const binding of bindings) dfs(binding)
  return cycleBindings
}

export function lookupVisibleBinding<T>(
  name: string,
  scopeId: number,
  bindingsByScope: Map<number, Map<string, T>>,
  scopeById: Map<number, SemanticScope>
): T | null {
  let currentScopeId: number | null = scopeId
  while (currentScopeId !== null) {
    const scopeBindings = bindingsByScope.get(currentScopeId)
    const found = scopeBindings?.get(name)
    if (found) return found
    currentScopeId = scopeById.get(currentScopeId)?.parentId ?? null
  }
  return null
}

function findOutOfScopeDeclaration(
  name: string,
  scopeId: number,
  declarationsByScope: Map<number, Map<string, SemanticDeclaration>>,
  scopeById: Map<number, SemanticScope>
): SemanticDeclaration | null {
  for (const [declarationScopeId, scopedDeclarations] of declarationsByScope.entries()) {
    const declaration = scopedDeclarations.get(name)
    if (!declaration) continue
    if (isScopeAncestor(declarationScopeId, scopeId, scopeById)) continue
    return declaration
  }
  return null
}

function isScopeAncestor(
  candidateAncestorScopeId: number,
  scopeId: number,
  scopeById: Map<number, SemanticScope>
): boolean {
  let currentScopeId: number | null = scopeId
  while (currentScopeId !== null) {
    if (currentScopeId === candidateAncestorScopeId) return true
    currentScopeId = scopeById.get(currentScopeId)?.parentId ?? null
  }
  return false
}

function collectDeclarationsByScope(
  declarations: SemanticDeclaration[],
  symbolKind: SemanticDeclaration['symbolKind']
): Map<number, Map<string, SemanticDeclaration>> {
  const declarationsByScope = new Map<number, Map<string, SemanticDeclaration>>()

  for (const declaration of declarations) {
    if (declaration.symbolKind !== symbolKind) continue
    let scoped = declarationsByScope.get(declaration.scopeId)
    if (!scoped) {
      scoped = new Map()
      declarationsByScope.set(declaration.scopeId, scoped)
    }
    scoped.set(declaration.name, declaration)
  }

  return declarationsByScope
}
