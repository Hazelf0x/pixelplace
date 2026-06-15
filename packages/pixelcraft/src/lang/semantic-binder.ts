import { ASTNode, Program } from './ast'
import {
  BoundProgram,
  SemanticDeclaration,
  SemanticScope,
  SemanticScopeKind
} from './semantic-types'

export interface SemanticBindOptions {
  defaultFilePath: string
}

export function bindProgramSemantics(program: Program, options: SemanticBindOptions): BoundProgram {
  const rootScope: SemanticScope = {
    id: 0,
    kind: 'root',
    parentId: null,
    ownerKind: 'program',
    ownerPos: { line: 1, column: 1, filePath: options.defaultFilePath }
  }
  const scopes: SemanticScope[] = [rootScope]
  const nodeScopes = new Map<ASTNode, number>()
  const declarations: SemanticDeclaration[] = []

  const createChildScope = (kind: Exclude<SemanticScopeKind, 'root'>, parentId: number, node: ASTNode): number => {
    const id = scopes.length
    scopes.push({
      id,
      kind,
      parentId,
      ownerKind: kind,
      ownerPos: node.pos
    })
    return id
  }

  const maybePushDeclaration = (node: ASTNode, scopeId: number): void => {
    switch (node.kind) {
      case 'let':
      case 'const':
        declarations.push({
          name: node.name,
          symbolKind: 'scalar',
          scopeId,
          nodeKind: node.kind,
          pos: node.pos
        })
        return
      case 'letpair':
      case 'letvec':
      case 'letsz':
        declarations.push({
          name: node.name,
          symbolKind: 'pair',
          aliasKind: node.aliasKind,
          scopeId,
          nodeKind: node.kind,
          pos: node.pos
        })
        return
      case 'anchor':
      case 'letpt':
      case 'defpt':
        declarations.push({
          name: node.name,
          symbolKind: 'point',
          scopeId,
          nodeKind: node.kind,
          pos: node.pos
        })
        return
      default:
        return
    }
  }

  const visitNodes = (nodes: ASTNode[], scopeId: number): void => {
    for (const node of nodes) {
      nodeScopes.set(node, scopeId)
      maybePushDeclaration(node, scopeId)
      switch (node.kind) {
        case 'group': {
          const childScopeId = createChildScope('group', scopeId, node)
          visitNodes(node.body, childScopeId)
          break
        }
        case 'repeat': {
          const childScopeId = createChildScope('repeat', scopeId, node)
          visitNodes(node.body, childScopeId)
          break
        }
        case 'frame': {
          const childScopeId = createChildScope('frame', scopeId, node)
          visitNodes(node.body, childScopeId)
          break
        }
        default:
          break
      }
    }
  }

  visitNodes(program.statements, rootScope.id)

  return {
    program,
    scopes,
    nodeScopes,
    declarations,
    diagnostics: []
  }
}
