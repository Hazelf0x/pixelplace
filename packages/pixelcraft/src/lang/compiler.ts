import { ASTNode, IncludeNode, ParseErrorCode, Program } from './ast'
import { parse } from './parser'
import { bindProgramSemantics } from './semantic-binder'
import { lowerSemanticProgram } from './semantic-lowering'
import { resolveSemanticProgram } from './semantic-resolver'
import { SemanticErrorCode } from './semantic-types'

export type IncludeCompileErrorCode =
  | 'I001' // include target not found
  | 'I002' // include cycle detected
  | 'I003' // invalid include path
  | 'I004' // include used in disallowed context
  | 'I005' // unsupported statement in included module

export type CompileErrorCode = ParseErrorCode | IncludeCompileErrorCode | SemanticErrorCode

export interface CompileError {
  code: CompileErrorCode
  message: string
  line: number
  column: number
  filePath: string
}

export interface CompileOptions {
  entryPath: string
  readFile: (path: string) => string | null | undefined
}

export interface CompileResult {
  program: Program
  errors: CompileError[]
}

const ALLOWED_INCLUDED_MODULE_KINDS = new Set<ASTNode['kind']>([
  'include',
  'group',
  'bitmap',
  'font',
  'tileset',
  'tilemap'
])

export function compileProgram(options: CompileOptions): CompileResult {
  const errors: CompileError[] = []
  const sourceCache = new Map<string, string | null>()
  const parseCache = new Map<string, Program>()
  const expandedCache = new Map<string, ASTNode[]>()
  const expansionStack: string[] = []

  const pushError = (error: CompileError): void => {
    errors.push(error)
  }

  const loadSource = (filePath: string): string | null => {
    if (sourceCache.has(filePath)) {
      return sourceCache.get(filePath) ?? null
    }

    const loaded = options.readFile(filePath)
    const source = typeof loaded === 'string' ? loaded : null
    sourceCache.set(filePath, source)
    return source
  }

  const parseProgram = (filePath: string): Program => {
    const cached = parseCache.get(filePath)
    if (cached) return cached

    const source = loadSource(filePath)
    if (source === null) {
      pushError({
        code: 'I001',
        message: `Include target not found: "${filePath}".`,
        line: 1,
        column: 1,
        filePath
      })
      const emptyProgram: Program = { statements: [] }
      parseCache.set(filePath, emptyProgram)
      return emptyProgram
    }

    const parsed = parse(source)
    attachProgramFilePath(parsed.program, filePath)
    for (const error of parsed.errors) {
      pushError({
        code: error.code,
        message: error.message,
        line: error.line,
        column: error.column,
        filePath
      })
    }

    parseCache.set(filePath, parsed.program)
    return parsed.program
  }

  const reportNestedIncludes = (node: ASTNode, filePath: string): void => {
    const nested = collectNestedIncludeNodes(node)
    for (const includeNode of nested) {
      pushError({
        code: 'I004',
        message: '"include" is only allowed as a top-level statement.',
        line: includeNode.pos.line,
        column: includeNode.pos.column,
        filePath
      })
    }
  }

  const expandFile = (filePath: string, isEntry: boolean): ASTNode[] => {
    const cached = expandedCache.get(filePath)
    if (cached) return cached

    if (expansionStack.includes(filePath)) {
      const cycle = [...expansionStack, filePath].join(' -> ')
      pushError({
        code: 'I002',
        message: `Include cycle detected: ${cycle}`,
        line: 1,
        column: 1,
        filePath
      })
      return []
    }

    expansionStack.push(filePath)

    const program = parseProgram(filePath)
    const expandedStatements: ASTNode[] = []

    for (const statement of program.statements) {
      if (statement.kind === 'include') {
        if (statement.fromWithLayerScope) {
          pushError({
            code: 'I004',
            message: '"include" is only allowed as a top-level statement.',
            line: statement.pos.line,
            column: statement.pos.column,
            filePath
          })
          continue
        }

        const resolved = resolveIncludePath(filePath, statement.path)
        if (!resolved.path) {
          pushError({
            code: 'I003',
            message: resolved.message,
            line: statement.pos.line,
            column: statement.pos.column,
            filePath
          })
          continue
        }

        const includePath = resolved.path
        if (expansionStack.includes(includePath)) {
          const cycle = [...expansionStack, includePath].join(' -> ')
          pushError({
            code: 'I002',
            message: `Include cycle detected: ${cycle}`,
            line: statement.pos.line,
            column: statement.pos.column,
            filePath
          })
          continue
        }

        if (loadSource(includePath) === null) {
          pushError({
            code: 'I001',
            message: `Include target not found: "${includePath}".`,
            line: statement.pos.line,
            column: statement.pos.column,
            filePath
          })
          continue
        }

        expandedStatements.push(...expandFile(includePath, false))
        continue
      }

      reportNestedIncludes(statement, filePath)

      if (!isEntry && !ALLOWED_INCLUDED_MODULE_KINDS.has(statement.kind)) {
        pushError({
          code: 'I005',
          message: `"${statement.kind}" is not allowed in included modules. Allowed: include, group, bitmap, font, tileset, tilemap.`,
          line: statement.pos.line,
          column: statement.pos.column,
          filePath
        })
        continue
      }

      expandedStatements.push(statement)
    }

    expansionStack.pop()
    expandedCache.set(filePath, expandedStatements)
    return expandedStatements
  }

  const normalizedEntryPath = normalizeEntryPath(options.entryPath)
  if (!normalizedEntryPath) {
    pushError({
      code: 'I003',
      message: `Invalid entry path: "${options.entryPath}". Entry path must be a non-empty project-relative file path.`,
      line: 1,
      column: 1,
      filePath: options.entryPath || 'main.pc'
    })
    return {
      program: { statements: [] },
      errors
    }
  }

  if (loadSource(normalizedEntryPath) === null) {
    pushError({
      code: 'I001',
      message: `Include target not found: "${normalizedEntryPath}".`,
      line: 1,
      column: 1,
      filePath: normalizedEntryPath
    })
    return {
      program: { statements: [] },
      errors
    }
  }

  const statements = expandFile(normalizedEntryPath, true)
  const surfaceProgram: Program = { statements }
  const boundProgram = bindProgramSemantics(surfaceProgram, { defaultFilePath: normalizedEntryPath })
  const resolvedProgram = resolveSemanticProgram(boundProgram)
  const loweredProgram = lowerSemanticProgram(resolvedProgram)

  for (const diagnostic of resolvedProgram.diagnostics) {
    pushError({
      code: diagnostic.code,
      message: diagnostic.message,
      line: diagnostic.line,
      column: diagnostic.column,
      filePath: diagnostic.filePath
    })
  }

  return {
    program: loweredProgram,
    errors
  }
}

export function compileSingleSource(source: string, entryPath = 'main.pc'): CompileResult {
  const normalizedEntryPath = normalizeEntryPath(entryPath)
  return compileProgram({
    entryPath,
    readFile: (path) => (
      path === entryPath || (normalizedEntryPath !== null && path === normalizedEntryPath)
        ? source
        : null
    )
  })
}

function normalizeEntryPath(entryPath: string): string | null {
  const trimmed = entryPath.trim()
  if (trimmed.length === 0) return null
  if (looksAbsolutePath(trimmed)) return null

  return normalizeRelativePath(trimmed.replace(/\\/g, '/'))
}

function resolveIncludePath(fromFilePath: string, rawIncludePath: string): { path: string | null; message: string } {
  const trimmed = rawIncludePath.trim()
  if (trimmed.length === 0) {
    return {
      path: null,
      message: 'Invalid include path: empty path. Use a quoted project-relative file path.'
    }
  }

  const normalizedRaw = trimmed.replace(/\\/g, '/')
  if (looksAbsolutePath(normalizedRaw)) {
    return {
      path: null,
      message: `Invalid include path: "${rawIncludePath}". Absolute paths are not allowed.`
    }
  }

  const baseDirectory = dirname(fromFilePath)
  const combined = baseDirectory.length > 0 ? `${baseDirectory}/${normalizedRaw}` : normalizedRaw
  const resolvedPath = normalizeRelativePath(combined)
  if (!resolvedPath) {
    return {
      path: null,
      message: `Invalid include path: "${rawIncludePath}". Path escapes project root or resolves to an empty target.`
    }
  }

  return {
    path: resolvedPath,
    message: ''
  }
}

function normalizeRelativePath(pathValue: string): string | null {
  const segments = pathValue.split('/')
  const normalizedSegments: string[] = []

  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..') {
      if (normalizedSegments.length === 0) return null
      normalizedSegments.pop()
      continue
    }
    normalizedSegments.push(segment)
  }

  if (normalizedSegments.length === 0) return null
  return normalizedSegments.join('/')
}

function dirname(pathValue: string): string {
  const index = pathValue.lastIndexOf('/')
  if (index < 0) return ''
  return pathValue.slice(0, index)
}

function looksAbsolutePath(pathValue: string): boolean {
  if (pathValue.startsWith('/')) return true
  return /^[A-Za-z]:[\/]/.test(pathValue)
}

function collectNestedIncludeNodes(node: ASTNode): IncludeNode[] {
  const nested: IncludeNode[] = []

  const visit = (candidate: ASTNode): void => {
    const children = getNodeChildren(candidate)
    for (const child of children) {
      if (child.kind === 'include') {
        nested.push(child)
        continue
      }
      visit(child)
    }
  }

  visit(node)
  return nested
}

function attachProgramFilePath(program: Program, filePath: string): void {
  for (const statement of program.statements) {
    attachNodeFilePath(statement, filePath)
  }
}

function attachNodeFilePath(node: ASTNode, filePath: string): void {
  node.pos.filePath = filePath
  for (const child of getNodeChildren(node)) {
    attachNodeFilePath(child, filePath)
  }
}

function getNodeChildren(node: ASTNode): ASTNode[] {
  switch (node.kind) {
    case 'group':
    case 'repeat':
    case 'frame':
      return node.body
    default:
      return []
  }
}
