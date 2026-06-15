export type TokenType =
  | 'KEYWORD'      // command or reserved word
  | 'NUMBER'       // 123, 0.5
  | 'VAR'          // $name
  | 'HEX_COLOR'    // #ff0044, #f00
  | 'NAMED_COLOR'  // skin=#ef7d57 (name=hex pair for palette)
  | 'DIMENSION'    // 16x16, 4x4
  | 'COORD'        // 8,8 (x,y pair)
  | 'SYMBOL'       // :x, :y, :xy
  | 'PLUS'         // +
  | 'MINUS'        // -
  | 'STAR'         // *
  | 'SLASH'        // /
  | 'PERCENT'      // %
  | 'COMMA'        // ,
  | 'RANGE'        // ..
  | 'LPAREN'       // (
  | 'RPAREN'       // )
  | 'EQUAL'        // =
  | 'STRING'       // "name"
  | 'UNTERMINATED_STRING' // "name (missing closing quote)
  | 'LBRACE'       // {
  | 'RBRACE'       // }
  | 'NEWLINE'
  | 'EOF'

export interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

export class Lexer {
  private input: string
  private pos = 0
  private line = 1
  private column = 1
  private tokens: Token[] = []

  constructor(input: string) {
    this.input = input
  }

  tokenize(): Token[] {
    while (this.pos < this.input.length) {
      this.skipWhitespace()
      if (this.pos >= this.input.length) break

      const char = this.peek()

      // Comment - skip to end of line
      if (char === '#' && this.shouldStartComment()) {
        this.skipComment()
        continue
      }

      // Newline
      if (char === '\n') {
        this.tokens.push(this.makeToken('NEWLINE', '\n'))
        this.advance()
        this.line++
        this.column = 1
        continue
      }

      // Braces
      if (char === '{') {
        this.tokens.push(this.makeToken('LBRACE', '{'))
        this.advance()
        continue
      }

      if (char === '}') {
        this.tokens.push(this.makeToken('RBRACE', '}'))
        this.advance()
        continue
      }

      if (char === '(') {
        this.tokens.push(this.makeToken('LPAREN', '('))
        this.advance()
        continue
      }

      if (char === ')') {
        this.tokens.push(this.makeToken('RPAREN', ')'))
        this.advance()
        continue
      }

      if (char === ',') {
        this.tokens.push(this.makeToken('COMMA', ','))
        this.advance()
        continue
      }

      if (char === '.' && this.peek(1) === '.') {
        this.tokens.push(this.makeToken('RANGE', '..'))
        this.advance()
        this.advance()
        continue
      }

      if (char === '=') {
        this.tokens.push(this.makeToken('EQUAL', '='))
        this.advance()
        continue
      }

      if (char === '*') {
        this.tokens.push(this.makeToken('STAR', '*'))
        this.advance()
        continue
      }

      if (char === '/') {
        this.tokens.push(this.makeToken('SLASH', '/'))
        this.advance()
        continue
      }

      if (char === '%') {
        this.tokens.push(this.makeToken('PERCENT', '%'))
        this.advance()
        continue
      }

      if (char === '+') {
        const signedCoord = this.canStartSignedCoordinate() ? this.tryReadSignedCoord() : null
        if (signedCoord) {
          this.tokens.push(signedCoord)
        } else {
          this.tokens.push(this.makeToken('PLUS', '+'))
          this.advance()
        }
        continue
      }

      if (char === '-') {
        const signedCoord = this.canStartSignedCoordinate() ? this.tryReadSignedCoord() : null
        if (signedCoord) {
          this.tokens.push(signedCoord)
        } else {
          this.tokens.push(this.makeToken('MINUS', '-'))
          this.advance()
        }
        continue
      }

      // Symbol (:x, :y, :xy)
      if (char === ':') {
        this.tokens.push(this.readSymbol())
        continue
      }

      if (char === '$') {
        this.tokens.push(this.readVariable())
        continue
      }

      // String ("name")
      if (char === '"') {
        this.tokens.push(this.readString())
        continue
      }

      // Hex color
      if (this.isHexColorStart()) {
        this.tokens.push(this.readHexColor())
        continue
      }

      // Number, dimension, or coordinate (including signed like +2,+3)
      if (this.isDigit(char)) {
        this.tokens.push(this.readNumberLike())
        continue
      }

      // Identifier/keyword
      if (this.isAlpha(char)) {
        this.tokens.push(this.readIdentifier())
        continue
      }

      // Skip unknown characters
      this.advance()
    }

    this.tokens.push(this.makeToken('EOF', ''))
    return this.tokens
  }

  private peek(offset = 0): string {
    return this.input[this.pos + offset] || ''
  }

  private advance(): string {
    const char = this.input[this.pos]
    this.pos++
    this.column++
    return char
  }

  private makeToken(type: TokenType, value: string): Token {
    return { type, value, line: this.line, column: this.column }
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const char = this.peek()
      if (char === ' ' || char === '\t' || char === '\r') {
        this.advance()
      } else {
        break
      }
    }
  }

  private skipComment(): void {
    while (this.pos < this.input.length && this.peek() !== '\n') {
      this.advance()
    }
  }

  private isHexColorStart(): boolean {
    if (this.peek() !== '#') return false
    const next = this.peek(1)
    return this.isHexDigit(next)
  }

  private shouldStartComment(): boolean {
    if (this.peek() !== '#') return false
    if (!this.isHexColorStart()) return true

    // Treat hash-prefixed command-ish text as comment, e.g. "#circ ...".
    // This keeps legacy hex parsing for pure hex runs (including invalid lengths).
    let offset = 1
    while (this.isHexDigit(this.peek(offset))) {
      offset++
    }
    return this.isAlpha(this.peek(offset))
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9'
  }

  private isHexDigit(char: string): boolean {
    return this.isDigit(char) || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_'
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char)
  }

  private readHexColor(): Token {
    const startCol = this.column
    let value = this.advance() // consume #

    while (this.pos < this.input.length && this.isHexDigit(this.peek())) {
      value += this.advance()
    }

    return { type: 'HEX_COLOR', value, line: this.line, column: startCol }
  }

  private readSymbol(): Token {
    const startCol = this.column
    let value = this.advance() // consume :

    while (this.pos < this.input.length && this.isAlphaNumeric(this.peek())) {
      value += this.advance()
    }

    return { type: 'SYMBOL', value, line: this.line, column: startCol }
  }

  private readString(): Token {
    const startCol = this.column
    this.advance() // consume opening "
    let value = ''

    while (this.pos < this.input.length && this.peek() !== '"' && this.peek() !== '\n') {
      value += this.advance()
    }

    if (this.peek() === '"') {
      this.advance() // consume closing "
      return { type: 'STRING', value, line: this.line, column: startCol }
    }

    return { type: 'UNTERMINATED_STRING', value, line: this.line, column: startCol }
  }

  private readNumberLike(): Token {
    const startCol = this.column
    let value = ''
    let hasFraction = false

    // Read first number
    while (this.pos < this.input.length && this.isDigit(this.peek())) {
      value += this.advance()
    }

    // Optional decimal fraction (e.g., 0.5). Keep ".." available for ranges.
    if (this.peek() === '.' && this.isDigit(this.peek(1))) {
      hasFraction = true
      value += this.advance() // consume '.'
      while (this.pos < this.input.length && this.isDigit(this.peek())) {
        value += this.advance()
      }
    }

    // Check for dimension (e.g., 16x16)
    if (!hasFraction && this.peek() === 'x' && this.isDigit(this.peek(1))) {
      value += this.advance() // consume 'x'
      while (this.pos < this.input.length && this.isDigit(this.peek())) {
        value += this.advance()
      }
      return { type: 'DIMENSION', value, line: this.line, column: startCol }
    }

    // Check for coordinate (e.g., 8,8 or +2,+3 or -1,0)
    const nextChar = this.peek()
    const afterComma = this.peek(1)
    if (
      !hasFraction &&
      nextChar === ',' &&
      (this.isDigit(afterComma) || afterComma === '+' || afterComma === '-') &&
      this.canStartCoordinateFromNumber()
    ) {
      value += this.advance() // consume ','
      // Read optional sign for second number
      if (this.peek() === '+' || this.peek() === '-') {
        value += this.advance()
      }
      while (this.pos < this.input.length && this.isDigit(this.peek())) {
        value += this.advance()
      }
      return { type: 'COORD', value, line: this.line, column: startCol }
    }

    return { type: 'NUMBER', value, line: this.line, column: startCol }
  }

  private tryReadSignedCoord(): Token | null {
    const sign = this.peek()
    if ((sign !== '+' && sign !== '-') || !this.isDigit(this.peek(1))) {
      return null
    }

    let i = this.pos + 1
    while (this.isDigit(this.input[i] || '')) {
      i++
    }

    if ((this.input[i] || '') !== ',') {
      return null
    }
    i++

    const secondSign = this.input[i] || ''
    if (secondSign === '+' || secondSign === '-') {
      i++
    }

    if (!this.isDigit(this.input[i] || '')) {
      return null
    }
    while (this.isDigit(this.input[i] || '')) {
      i++
    }

    const startCol = this.column
    let value = this.advance() // consume sign
    while (this.pos < this.input.length && this.isDigit(this.peek())) {
      value += this.advance()
    }
    value += this.advance() // consume comma
    if (this.peek() === '+' || this.peek() === '-') {
      value += this.advance()
    }
    while (this.pos < this.input.length && this.isDigit(this.peek())) {
      value += this.advance()
    }

    return { type: 'COORD', value, line: this.line, column: startCol }
  }

  private canStartSignedCoordinate(): boolean {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const type = this.tokens[i].type
      if (type === 'NEWLINE') continue
      return type !== 'NUMBER' && type !== 'VAR' && type !== 'RPAREN'
    }
    return true
  }

  private canStartCoordinateFromNumber(): boolean {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const type = this.tokens[i].type
      if (type === 'NEWLINE') continue
      return type !== 'PLUS' &&
        type !== 'MINUS' &&
        type !== 'STAR' &&
        type !== 'SLASH' &&
        type !== 'PERCENT' &&
        type !== 'LPAREN' &&
        type !== 'COMMA' &&
        type !== 'EQUAL' &&
        type !== 'NUMBER' &&
        type !== 'VAR' &&
        type !== 'RPAREN'
    }
    return true
  }

  private readVariable(): Token {
    const startCol = this.column
    this.advance() // consume $
    let value = ''

    if (!this.isAlpha(this.peek())) {
      return { type: 'VAR', value, line: this.line, column: startCol }
    }

    while (this.pos < this.input.length && this.isAlphaNumeric(this.peek())) {
      value += this.advance()
    }

    return { type: 'VAR', value, line: this.line, column: startCol }
  }

  private readIdentifier(): Token {
    const startCol = this.column
    let value = ''

    while (this.pos < this.input.length && this.isAlphaNumeric(this.peek())) {
      value += this.advance()
    }

    // Check for named color pattern: name=#hex or gradient: name=#hex..#hex
    if (this.peek() === '=' && this.peek(1) === '#' && this.isHexDigit(this.peek(2))) {
      value += this.advance() // consume '='
      value += this.advance() // consume '#'
      while (this.pos < this.input.length && this.isHexDigit(this.peek())) {
        value += this.advance()
      }
      // Check for gradient range: ..#hex
      if (this.peek() === '.' && this.peek(1) === '.' && this.peek(2) === '#' && this.isHexDigit(this.peek(3))) {
        value += this.advance() // consume first '.'
        value += this.advance() // consume second '.'
        value += this.advance() // consume '#'
        while (this.pos < this.input.length && this.isHexDigit(this.peek())) {
          value += this.advance()
        }
      }
      return { type: 'NAMED_COLOR', value, line: this.line, column: startCol }
    }

    const type: TokenType = 'KEYWORD'
    return { type, value, line: this.line, column: startCol }
  }
}

export function tokenize(input: string): Token[] {
  return new Lexer(input).tokenize()
}
