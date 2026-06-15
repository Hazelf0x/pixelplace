interface FormatOptions {
  indent?: string
  maxConsecutiveBlankLines?: number
}

const DEFAULT_INDENT = '  '
const DEFAULT_MAX_BLANKS = 1

export function formatSource(source: string, options: FormatOptions = {}): string {
  const indentUnit = options.indent ?? DEFAULT_INDENT
  const maxConsecutiveBlankLines = Math.max(0, options.maxConsecutiveBlankLines ?? DEFAULT_MAX_BLANKS)
  const normalized = source.replace(/\r\n?/g, '\n')
  const inputLines = normalized.split('\n')
  const outputLines: string[] = []

  let braceDepth = 0
  let blankRun = 0

  for (const rawLine of inputLines) {
    const line = rawLine.replace(/[ \t]+$/g, '')
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      blankRun++
      if (outputLines.length === 0) continue
      if (blankRun <= maxConsecutiveBlankLines) {
        outputLines.push('')
      }
      continue
    }

    blankRun = 0

    const leadingCloseCount = countLeadingCloseBraces(trimmed)
    const lineDepth = Math.max(0, braceDepth - leadingCloseCount)
    outputLines.push(`${indentUnit.repeat(lineDepth)}${trimmed}`)
    braceDepth = scanBraceDepthAfterLine(trimmed, braceDepth)
  }

  while (outputLines.length > 0 && outputLines[outputLines.length - 1] === '') {
    outputLines.pop()
  }

  return outputLines.length === 0 ? '' : `${outputLines.join('\n')}\n`
}

function countLeadingCloseBraces(line: string): number {
  let count = 0
  while (count < line.length && line[count] === '}') {
    count++
  }
  return count
}

function scanBraceDepthAfterLine(line: string, startingDepth: number): number {
  let depth = Math.max(0, startingDepth)
  let inString = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (inString) {
      if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '#' && shouldStartComment(line, i)) {
      break
    }

    if (ch === '{') {
      depth++
      continue
    }

    if (ch === '}') {
      depth = Math.max(0, depth - 1)
    }
  }

  return depth
}

function shouldStartComment(line: string, index: number): boolean {
  if (line[index] !== '#') return false

  const next = line[index + 1]
  if (!isHexDigit(next)) return true

  let cursor = index + 1
  while (cursor < line.length && isHexDigit(line[cursor])) {
    cursor++
  }

  return isAlpha(line[cursor])
}

function isHexDigit(ch: string | undefined): boolean {
  if (!ch) return false
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
}

function isAlpha(ch: string | undefined): boolean {
  if (!ch) return false
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}
