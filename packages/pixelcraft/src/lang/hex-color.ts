const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function isValidHexColorLiteral(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value)
}

export function parseHexColorLiteral(value: string): [number, number, number, number] | null {
  if (!isValidHexColorLiteral(value)) return null

  const raw = value.slice(1)
  if (raw.length === 3 || raw.length === 4) {
    const r = parseInt(raw[0] + raw[0], 16)
    const g = parseInt(raw[1] + raw[1], 16)
    const b = parseInt(raw[2] + raw[2], 16)
    const a = raw.length === 4 ? parseInt(raw[3] + raw[3], 16) : 255
    return [r, g, b, a]
  }

  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) : 255
  return [r, g, b, a]
}

export function isTransparentHexColorLiteral(value: string): boolean {
  const rgba = parseHexColorLiteral(value)
  if (!rgba) return false
  return rgba[3] === 0
}
