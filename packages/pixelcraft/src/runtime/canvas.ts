import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH } from '../canvas-limits'
import { parseHexColorLiteral } from '../lang/hex-color'

export interface PixelCanvasOptions {
  willReadFrequently?: boolean
}

interface DrawColor {
  safeHex: string
  isClear: boolean
}

export class PixelCanvas {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private palette: string[] = ['#000000']
  private scale: number
  private fixedScale: number | null = null
  private paletteVersion = 0
  private drawColorCache = new Map<string, DrawColor>()
  private parsedHexColorCache = new Map<string, [number, number, number, number] | null>()
  private lastFillStyle: string | null = null

  constructor(
    canvas: HTMLCanvasElement,
    width = DEFAULT_CANVAS_WIDTH,
    height = DEFAULT_CANVAS_HEIGHT,
    scale = 16,
    fixedScale: number | null = null,
    options: PixelCanvasOptions = {}
  ) {
    const context = canvas.getContext('2d', { willReadFrequently: options.willReadFrequently === true })
    if (!context) {
      throw new Error('Failed to acquire a 2D canvas context.')
    }

    this.ctx = context
    this.width = width
    this.height = height
    this.scale = scale
    this.fixedScale = fixedScale
    this.resize(width, height)
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height

    if (this.fixedScale !== null) {
      this.scale = Math.max(1, Math.floor(this.fixedScale))
    } else {
      // Calculate scale to fit nicely in the preview area
      const maxSize = 400
      this.scale = Math.floor(maxSize / Math.max(width, height))
      this.scale = Math.max(1, Math.min(this.scale, 32)) // Clamp between 1 and 32
    }

    this.ctx.canvas.width = width * this.scale
    this.ctx.canvas.height = height * this.scale
    this.ctx.imageSmoothingEnabled = false
    this.lastFillStyle = null
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
    this.lastFillStyle = null
  }

  setPalette(colors: string[]): void {
    this.palette = colors.length > 0 ? [...colors] : ['#000000']
    this.paletteVersion++
    this.drawColorCache.clear()
  }

  getPalette(): string[] {
    return this.palette
  }

  private resolveColor(color: { type: 'hex' | 'index'; value: string | number }): string {
    if (color.type === 'hex') {
      return color.value as string
    }
    const index = Number(color.value)
    return this.palette[index] || '#000000'
  }

  private parseHexColor(hex: string): [number, number, number, number] | null {
    const cached = this.parsedHexColorCache.get(hex)
    if (cached !== undefined) {
      return cached
    }

    const parsed = parseHexColorLiteral(hex)
    this.parsedHexColorCache.set(hex, parsed)
    return parsed
  }

  private resolveDrawColor(color: { type: 'hex' | 'index'; value: string | number }): DrawColor {
    const cacheKey = color.type === 'hex'
      ? `hex:${String(color.value)}`
      : `idx:${this.paletteVersion}:${String(color.value)}`

    const cached = this.drawColorCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const hex = this.resolveColor(color)
    const rgba = this.parseHexColor(hex)
    const resolved: DrawColor = {
      safeHex: rgba ? hex : '#000000',
      isClear: rgba !== null && rgba[3] === 0
    }
    this.drawColorCache.set(cacheKey, resolved)
    return resolved
  }

  private setFillStyle(fillStyle: string): void {
    if (this.lastFillStyle === fillStyle) return
    this.ctx.fillStyle = fillStyle
    this.lastFillStyle = fillStyle
  }

  private colorsEqual(a: [number, number, number, number], b: [number, number, number, number]): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
  }

  pixel(x: number, y: number, color: { type: 'hex' | 'index'; value: string | number }): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return

    const drawColor = this.resolveDrawColor(color)

    if (drawColor.isClear) {
      this.ctx.clearRect(x * this.scale, y * this.scale, this.scale, this.scale)
      return
    }

    this.setFillStyle(drawColor.safeHex)
    this.ctx.fillRect(x * this.scale, y * this.scale, this.scale, this.scale)
  }

  rect(x: number, y: number, w: number, h: number, color: { type: 'hex' | 'index'; value: string | number }): void {
    if (w <= 0 || h <= 0) return

    const clippedX = Math.max(0, x)
    const clippedY = Math.max(0, y)
    const clippedRight = Math.min(this.width, x + w)
    const clippedBottom = Math.min(this.height, y + h)

    if (clippedX >= clippedRight || clippedY >= clippedBottom) return

    const drawX = clippedX * this.scale
    const drawY = clippedY * this.scale
    const drawW = (clippedRight - clippedX) * this.scale
    const drawH = (clippedBottom - clippedY) * this.scale

    const drawColor = this.resolveDrawColor(color)
    if (drawColor.isClear) {
      this.ctx.clearRect(drawX, drawY, drawW, drawH)
      return
    }

    this.setFillStyle(drawColor.safeHex)
    this.ctx.fillRect(drawX, drawY, drawW, drawH)
  }

  line(x1: number, y1: number, x2: number, y2: number, color: { type: 'hex' | 'index'; value: string | number }): void {
    // Bresenham's line algorithm
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const sx = x1 < x2 ? 1 : -1
    const sy = y1 < y2 ? 1 : -1
    let err = dx - dy

    let x = x1
    let y = y1

    while (true) {
      this.pixel(x, y, color)

      if (x === x2 && y === y2) break

      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x += sx
      }
      if (e2 < dx) {
        err += dx
        y += sy
      }
    }
  }

  circle(cx: number, cy: number, radius: number, color: { type: 'hex' | 'index'; value: string | number }): void {
    // Midpoint circle algorithm for filled circle
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x * x + y * y <= radius * radius) {
          this.pixel(cx + x, cy + y, color)
        }
      }
    }
  }

  polygon(points: Array<{ x: number; y: number }>, color: { type: 'hex' | 'index'; value: string | number }): void {
    if (points.length < 3) return

    // Find bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }

    // Scanline fill algorithm
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        if (this.pointInPolygon(x, y, points)) {
          this.pixel(x, y, color)
        }
      }
    }
  }

  private pointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
    // Ray casting algorithm
    let inside = false
    const n = points.length

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = points[i].x, yi = points[i].y
      const xj = points[j].x, yj = points[j].y

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }

    return inside
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

  getScale(): number {
    return this.scale
  }

  setFixedScale(scale: number | null): void {
    this.fixedScale = scale
    this.resize(this.width, this.height)
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx
  }

  captureSnapshot(target?: HTMLCanvasElement): HTMLCanvasElement {
    const sourceCanvas = this.ctx.canvas
    const snapshot = !target || target === sourceCanvas
      ? document.createElement('canvas')
      : target

    if (snapshot.width !== sourceCanvas.width || snapshot.height !== sourceCanvas.height) {
      snapshot.width = sourceCanvas.width
      snapshot.height = sourceCanvas.height
    }

    const snapshotCtx = snapshot.getContext('2d')
    if (!snapshotCtx) {
      throw new Error('Failed to acquire a snapshot canvas context.')
    }
    snapshotCtx.imageSmoothingEnabled = false
    snapshotCtx.clearRect(0, 0, snapshot.width, snapshot.height)
    snapshotCtx.drawImage(sourceCanvas, 0, 0)

    return snapshot
  }

  getImageData(): ImageData {
    return this.ctx.getImageData(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
  }

  restoreSnapshot(snapshot: HTMLCanvasElement | ImageData): void {
    this.lastFillStyle = null

    if (snapshot instanceof ImageData) {
      this.ctx.putImageData(snapshot, 0, 0)
      return
    }

    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
    this.ctx.drawImage(snapshot, 0, 0)
  }

  fill(startX: number, startY: number, color: { type: 'hex' | 'index'; value: string | number }): void {
    // Bounds check
    if (startX < 0 || startX >= this.width || startY < 0 || startY >= this.height) return

    const imageData = this.ctx.getImageData(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
    const data = imageData.data
    const sampleOffset = Math.floor(this.scale / 2)
    const canvasWidth = this.ctx.canvas.width
    const targetColor = this.getPixelRgbaFromData(data, startX, startY, sampleOffset, canvasWidth)

    const fillHex = this.resolveColor(color)
    const parsedFill = this.parseHexColor(fillHex)
    const fillRgba = parsedFill || [0, 0, 0, 255]
    const safeFillHex = parsedFill ? fillHex : '#000000'

    // If target color is same as fill color, nothing to do
    if (this.colorsEqual(targetColor, fillRgba)) return

    const queue: Array<[number, number]> = [[startX, startY]]
    const visited = new Uint8Array(this.width * this.height)
    const isClear = fillRgba[3] === 0
    let head = 0

    if (!isClear) {
      this.setFillStyle(safeFillHex)
    }

    while (head < queue.length) {
      const [x, y] = queue[head++]
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue

      const visitedIndex = y * this.width + x
      if (visited[visitedIndex]) continue
      visited[visitedIndex] = 1

      const currentColor = this.getPixelRgbaFromData(data, x, y, sampleOffset, canvasWidth)
      if (!this.colorsEqual(currentColor, targetColor)) continue

      // Fill this pixel
      if (isClear) {
        this.ctx.clearRect(x * this.scale, y * this.scale, this.scale, this.scale)
      } else {
        this.ctx.fillRect(x * this.scale, y * this.scale, this.scale, this.scale)
      }

      // Add neighbors
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
  }

  private getPixelRgbaFromData(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    sampleOffset: number,
    canvasWidth: number
  ): [number, number, number, number] {
    const sampleX = x * this.scale + sampleOffset
    const sampleY = y * this.scale + sampleOffset
    const pixelIndex = (sampleY * canvasWidth + sampleX) * 4

    return [
      data[pixelIndex] ?? 0,
      data[pixelIndex + 1] ?? 0,
      data[pixelIndex + 2] ?? 0,
      data[pixelIndex + 3] ?? 0
    ]
  }
}
