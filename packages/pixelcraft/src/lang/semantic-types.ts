import { ASTNode, Position, Program } from './ast'

export type SemanticErrorCode =
  | 'S001' // unknown symbol
  | 'S002' // symbol kind mismatch
  | 'S003' // duplicate declaration in scope
  | 'S004' // circular symbol dependency
  | 'S005' // invalid pair expression
  | 'S006' // invalid point expression
  | 'S007' // invalid symbol visibility/scope access
  | 'S008' // incompatible mixed legacy/declarative usage
  | 'S009' // invalid repeat step form
  | 'S010' // strict-mode legacy command usage
  | 'S011' // symbol used before declaration (order-sensitive legacy declarations)

export type SemanticSymbolKind = 'scalar' | 'pair' | 'point'
export type SemanticAliasKind = 'pair' | 'size' | 'vec'
export type SemanticScopeKind = 'root' | 'group' | 'repeat' | 'frame'

export interface SemanticDiagnostic {
  code: SemanticErrorCode
  message: string
  line: number
  column: number
  filePath: string
}

export interface SemanticScope {
  id: number
  kind: SemanticScopeKind
  parentId: number | null
  ownerKind: 'program' | 'group' | 'repeat' | 'frame'
  ownerPos?: Position
}

export interface SemanticDeclaration {
  name: string
  symbolKind: SemanticSymbolKind
  scopeId: number
  aliasKind?: SemanticAliasKind
  nodeKind: ASTNode['kind']
  pos: Position
}

export interface BoundProgram {
  program: Program
  scopes: SemanticScope[]
  nodeScopes: Map<ASTNode, number>
  declarations: SemanticDeclaration[]
  diagnostics: SemanticDiagnostic[]
}

export interface ResolvedProgram {
  program: Program
  scopes: SemanticScope[]
  nodeScopes: Map<ASTNode, number>
  declarations: SemanticDeclaration[]
  diagnostics: SemanticDiagnostic[]
}
