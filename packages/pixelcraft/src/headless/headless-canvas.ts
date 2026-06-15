import { ResolvedColor } from '../lang/ast'
import { parseHexColorLiteral } from '../lang/hex-color'
import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH } from '../canvas-limits'

type PixelKey = `${number},${number}`
type PixelRgba = [number, number, number, number]

export class HeadlessPixelCanvas {
  private width: number
  private height: number
  private palette: string[] = ['#000000']
  private pixels: Map<PixelKey, PixelRgba> = new Map()

  constructor(width = DEFAULT_CANVAS_WIDTH, height = DEFAULT_CANVAS_HEIGHT) {
    this.width = width
    this.height = height
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.pixels.clear()
  }

  clear(): void {
    this.pixels.clear()
  }

  setPalette(colors: string[]): void {
    this.palette = colors.length > 0 ? [...colors] : ['#000000']
  }

  getPalette(): string[] {
    return [...this.palette]
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  getCenter(): { x: number; y: number } {
    return {
      x: Math.floor(this.width / 2),
      y: Math.floor(this.height / 2)
    }
  }

  pixel(x: number, y: number, color: ResolvedColor): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return
    }

    const key = this.makeKey(x, y)
    const source = this.resolveColorToRgba(color)

    if (source[3] === 0) {
      this.pixels.delete(key)
      return
    }

    const existing = this.pixels.get(key)
    if (!existing || source[3] === 255) {
      this.pixels.set(key, [...source] as PixelRgba)
      return
    }

    this.pixels.set(key, this.blendRgba(source, existing))
  }

  getPixel(x: number, y: number): ResolvedColor | undefined {
    const rgba = this.pixels.get(this.makeKey(x, y))
    if (!rgba) return undefined

    const paletteIndex = this.findPaletteIndex(rgba)
    if (paletteIndex !== null) {
      return { type: 'index', value: paletteIndex }
    }

    return { type: 'hex', value: this.rgbaToHex(rgba) }
  }

  captureSnapshot(): Map<PixelKey, PixelRgba> {
    return new Map(Array.from(this.pixels.entries(), ([key, color]) => [
      key,
      [...color] as PixelRgba
    ]))
  }

  restoreSnapshot(snapshot: unknown): void {
    if (!(snapshot instanceof Map)) {
      this.clear()
      return
    }

    this.pixels = new Map()
    for (const [key, color] of snapshot.entries()) {
      if (typeof key !== 'string' || !color || typeof color !== 'object') {
        continue
      }
      if (!Array.isArray(color) || color.length !== 4) {
        continue
      }
      const rgba = color as number[]
      this.pixels.set(key as PixelKey, [
        this.clampByte(rgba[0]),
        this.clampByte(rgba[1]),
        this.clampByte(rgba[2]),
        this.clampByte(rgba[3])
      ])
    }
  }

  private makeKey(x: number, y: number): PixelKey {
    return `${x},${y}`
  }

  private resolveColorToRgba(color: ResolvedColor): PixelRgba {
    if (color.type === 'hex') {
      return parseHexColorLiteral(String(color.value)) ?? [0, 0, 0, 255]
    }

    const index = Number(color.value)
    const hex = this.palette[index] ?? '#000000'
    return parseHexColorLiteral(hex) ?? [0, 0, 0, 255]
  }

  private blendRgba(source: PixelRgba, dest: PixelRgba): PixelRgba {
    const srcA = source[3] / 255
    const dstA = dest[3] / 255
    const outA = srcA + dstA * (1 - srcA)

    if (outA <= 0) {
      return [0, 0, 0, 0]
    }

    const outR = Math.round((source[0] * srcA + dest[0] * dstA * (1 - srcA)) / outA)
    const outG = Math.round((source[1] * srcA + dest[1] * dstA * (1 - srcA)) / outA)
    const outB = Math.round((source[2] * srcA + dest[2] * dstA * (1 - srcA)) / outA)
    const outAlpha = Math.round(outA * 255)

    return [outR, outG, outB, outAlpha]
  }

  private findPaletteIndex(rgba: PixelRgba): number | null {
    for (let index = 0; index < this.palette.length; index++) {
      const parsed = parseHexColorLiteral(this.palette[index])
      if (
        parsed !== null &&
        parsed[0] === rgba[0] &&
        parsed[1] === rgba[1] &&
        parsed[2] === rgba[2] &&
        parsed[3] === rgba[3]
      ) {
        return index
      }
    }
    return null
  }

  private rgbaToHex([r, g, b, a]: PixelRgba): string {
    return `#${this.byteToHex(r)}${this.byteToHex(g)}${this.byteToHex(b)}${this.byteToHex(a)}`
  }

  private byteToHex(value: number): string {
    return this.clampByte(value).toString(16).padStart(2, '0')
  }

  private clampByte(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(255, Math.round(value)))
  }
}
