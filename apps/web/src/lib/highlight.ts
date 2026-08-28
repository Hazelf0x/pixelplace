// Syntax highlighting for PixelCraft, driven by the compiler's own lexer.
//
// The point is not prettiness. A hand-written regex highlighter is a second,
// informal definition of the language that drifts from the real one — it will
// eventually colour something the compiler rejects, or fail to colour something
// it accepts. Using `tokenize()` means the highlighting and the parsing can never
// disagree, because they are the same code.
//
// One thing the lexer does not hand us: comments. It discards them, since the
// parser has no use for them. So the gaps between tokens are examined here, and a
// `#` in a gap starts a comment that runs to the end of the line.
import { tokenize, type Token } from '@pixelplace/pixelcraft/browser'

export type SpanKind =
  | 'keyword'
  | 'number'
  | 'var'
  | 'color'
  | 'name'
  | 'string'
  | 'symbol'
  | 'punct'
  | 'comment'
  | 'plain'

export interface Span {
  text: string
  kind: SpanKind
  /** Set for `color` spans: the literal the token names, made readable on ink. */
  swatch?: string
}

export type HighlightedLine = Span[]

const KIND_BY_TOKEN: Partial<Record<Token['type'], SpanKind>> = {
  KEYWORD: 'keyword',
  NUMBER: 'number',
  DIMENSION: 'number',
  COORD: 'number',
  RANGE: 'number',
  VAR: 'var',
  HEX_COLOR: 'color',
  NAMED_COLOR: 'name',
  STRING: 'string',
  SYMBOL: 'symbol'
}

/**
 * Lift a colour off the page without lying about it.
 *
 * A palette entry can legitimately be near-black, which is unreadable as text on an
 * ink background. Rather than substitute a different colour, the literal is mixed
 * toward white only as far as it takes to clear a floor — so a dark colour still
 * reads as dark, just visibly.
 */
export function readableColor(hex: string): string {
  const raw = hex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.slice(0, 6)
  if (full.length !== 6) return hex

  let r = parseInt(full.slice(0, 2), 16)
  let g = parseInt(full.slice(2, 4), 16)
  let b = parseInt(full.slice(4, 6), 16)

  // Rec. 601 luma, which tracks perceived brightness closely enough here.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const floor = 0.45
  if (luma < floor) {
    const mix = (floor - luma) / (1 - luma)
    r = Math.round(r + (255 - r) * mix)
    g = Math.round(g + (255 - g) * mix)
    b = Math.round(b + (255 - b) * mix)
  }
  return `rgb(${r}, ${g}, ${b})`
}

function pushGap(spans: Span[], text: string) {
  if (!text) return
  const hash = text.indexOf('#')
  if (hash === -1) {
    spans.push({ text, kind: 'plain' })
    return
  }
  // The lexer threw the comment away, so anything from `#` onward is one.
  if (hash > 0) spans.push({ text: text.slice(0, hash), kind: 'plain' })
  spans.push({ text: text.slice(hash), kind: 'comment' })
}

function pushToken(spans: Span[], token: Token) {
  const kind = KIND_BY_TOKEN[token.type] ?? 'punct'

  if (kind === 'color') {
    spans.push({ text: token.value, kind, swatch: readableColor(token.value) })
    return
  }

  // `name=#hex` arrives as one token; split it so the literal keeps its own colour.
  if (kind === 'name' && token.value.includes('=')) {
    const eq = token.value.indexOf('=')
    const name = token.value.slice(0, eq)
    const value = token.value.slice(eq + 1)
    spans.push({ text: name, kind: 'name' })
    spans.push({ text: '=', kind: 'punct' })
    spans.push({ text: value, kind: 'color', swatch: readableColor(value) })
    return
  }

  spans.push({ text: token.value, kind })
}

/**
 * Split `source` into lines of styled spans.
 *
 * Tokens carry 1-based line and column, so each line is rebuilt by walking its own
 * tokens in order and treating whatever sits between them as gap text. That keeps
 * the original spacing byte for byte, which matters: this renders inside a `pre`,
 * and in the Studio it has to line up under a textarea exactly.
 */
export function highlight(source: string): HighlightedLine[] {
  const lines = source.split(/\r?\n/)

  let tokens: Token[]
  try {
    tokens = tokenize(source)
  } catch {
    // A source too broken even to lex still has to render. Plain text is correct.
    return lines.map((line) => (line ? [{ text: line, kind: 'plain' as const }] : []))
  }

  const byLine = new Map<number, Token[]>()
  for (const token of tokens) {
    if (token.type === 'EOF' || token.type === 'NEWLINE') continue
    const list = byLine.get(token.line)
    if (list) list.push(token)
    else byLine.set(token.line, [token])
  }

  return lines.map((line, index) => {
    const spans: Span[] = []
    const lineTokens = byLine.get(index + 1) ?? []
    let cursor = 0

    for (const token of lineTokens) {
      const start = token.column - 1
      // A token whose recorded column has been overtaken means the lexer merged or
      // rewrote something; skip rather than emit overlapping text.
      if (start < cursor) continue
      pushGap(spans, line.slice(cursor, start))
      pushToken(spans, token)
      cursor = start + token.value.length
    }

    pushGap(spans, line.slice(cursor))
    return spans
  })
}
