import { Position } from './ast'
import { SemanticDiagnostic, SemanticErrorCode } from './semantic-types'

export function createSemanticDiagnostic(
  code: SemanticErrorCode,
  message: string,
  pos: Position,
  fallbackFilePath: string
): SemanticDiagnostic {
  return {
    code,
    message,
    line: pos.line,
    column: pos.column,
    filePath: pos.filePath ?? fallbackFilePath
  }
}
