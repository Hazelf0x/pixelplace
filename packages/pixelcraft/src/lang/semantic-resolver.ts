import { buildSemanticSymbolModel } from './semantic-symbol-model'
import { validateSemanticProgram } from './semantic-validation'
import { BoundProgram, ResolvedProgram, SemanticDiagnostic } from './semantic-types'

export function resolveSemanticProgram(bound: BoundProgram): ResolvedProgram {
  const diagnostics: SemanticDiagnostic[] = [...bound.diagnostics]
  const symbolModel = buildSemanticSymbolModel(bound, diagnostics)

  validateSemanticProgram(bound, diagnostics, symbolModel)

  return {
    program: bound.program,
    scopes: bound.scopes,
    nodeScopes: bound.nodeScopes,
    declarations: bound.declarations,
    diagnostics
  }
}
