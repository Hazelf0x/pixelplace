// Client-side rendering helpers.
//
// Everything here runs in the browser: the PixelCraft compiler, the interpreter,
// and the canvas. No request leaves the page to draw a picture.
import {
  measureCoverage,
  renderGif,
  renderToRgba,
  type BrowserRenderResult
} from '@pixelplace/pixelcraft/browser'

/** Paint an engine RGBA buffer into a real canvas, unsmoothed so pixels stay pixels. */
export function paintToCanvas(canvas: HTMLCanvasElement, result: BrowserRenderResult): void {
  if (!result.ok || result.width === 0) return
  canvas.width = result.width
  canvas.height = result.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  // The engine's buffer is plain RGBA in the exact layout ImageData wants.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Save the current program as a PNG. The browser's own encoder does the work. */
export async function downloadPng(source: string, scale: number, frame: number, name: string): Promise<string> {
  const result = renderToRgba(source, { scale, frame })
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.code} ${e.message}`).join('; '))

  const canvas = document.createElement('canvas')
  paintToCanvas(canvas, result)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The browser could not encode the PNG.')

  const filename = `${name}-${result.width}x${result.height}.png`
  triggerDownload(blob, filename)
  return filename
}

/** Save an animated program as a looping GIF, encoded client-side by gifenc. */
export function downloadGif(source: string, scale: number, fps: number, name: string): string {
  const result = renderGif(source, { scale, fps })
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.code} ${e.message}`).join('; '))
  const filename = `${name}-${result.frameCount}f.gif`
  triggerDownload(new Blob([result.gif as BlobPart], { type: 'image/gif' }), filename)
  return filename
}

/** Save the source itself — the only export that round-trips back into the editor. */
export function downloadSource(source: string, name: string): string {
  const filename = `${name}.pc`
  triggerDownload(new Blob([source], { type: 'text/plain;charset=utf-8' }), filename)
  return filename
}

// ---------------------------------------------------------------------------
// Describing a render in text
// ---------------------------------------------------------------------------

// WebMCP tool results must be JSON-serializable, so a tool can never hand an agent
// the picture. That is a real constraint and this is the honest way around it: give
// the agent a coarse, textual read of the canvas — enough to tell whether the shape
// landed where it meant, whether the piece is off-centre, whether it accidentally
// filled the background — while the PERSON looking at the page judges whether it is
// any good. Structure is checkable in text; "is this actually a slime" needs eyes.

/** Characters used for the text map, in palette order. '.' always means transparent. */
const MAP_KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export interface RenderDescription {
  width: number
  height: number
  hasAnimation: boolean
  frameCount: number
  paletteDeclared: string[]
  colorsPainted: string[]
  coverage: { frame: number; maxAcrossFrames: number }
  /** Bounding box of everything painted, or null when the frame is empty. */
  bounds: { x: number; y: number; width: number; height: number } | null
  /** Rows of a downsampled text map; `legend` says what each character means. */
  map: string[]
  legend: Record<string, string>
  note: string
}

/**
 * Reduce a rendered frame to a small character grid.
 *
 * Each cell reports the most common opaque color in that region, so the map shows
 * layout and silhouette rather than exact pixels. Capped at 32 columns because a
 * larger grid costs an agent tokens without telling it much more.
 */
export function describeRender(source: string, frame = 0, maxDimension = 24): RenderDescription {
  const render = renderToRgba(source, { frame, scale: 1 })
  if (!render.ok) {
    throw new Error(render.errors.map((e) => `${e.code} at ${e.line}:${e.column} — ${e.message}`).join('; '))
  }

  const { rgba, sourceWidth: w, sourceHeight: h } = render
  const hex = (i: number) =>
    `#${rgba[i].toString(16).padStart(2, '0')}${rgba[i + 1].toString(16).padStart(2, '0')}${rgba[i + 2]
      .toString(16)
      .padStart(2, '0')}`

  // Assign a stable character per distinct painted color, most-used first, so the
  // busiest colors get the lowest digits and the map reads consistently.
  const tally = new Map<string, number>()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (rgba[i + 3] === 0) continue
      tally.set(hex(i), (tally.get(hex(i)) ?? 0) + 1)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const ordered = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color)
  const keyFor = new Map(ordered.map((color, index) => [color, MAP_KEYS[index] ?? '?']))

  const step = Math.max(1, Math.ceil(Math.max(w, h) / maxDimension))
  const map: string[] = []
  for (let cellY = 0; cellY < h; cellY += step) {
    let row = ''
    for (let cellX = 0; cellX < w; cellX += step) {
      const counts = new Map<string, number>()
      let opaque = 0
      let total = 0
      for (let y = cellY; y < Math.min(cellY + step, h); y++) {
        for (let x = cellX; x < Math.min(cellX + step, w); x++) {
          total++
          const i = (y * w + x) * 4
          if (rgba[i + 3] === 0) continue
          opaque++
          counts.set(hex(i), (counts.get(hex(i)) ?? 0) + 1)
        }
      }
      // A cell that is mostly empty reads as empty; otherwise its dominant color wins.
      if (opaque * 2 < total) {
        row += '.'
      } else {
        const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
        row += dominant ? keyFor.get(dominant[0]) ?? '?' : '.'
      }
    }
    map.push(row)
  }

  const legend: Record<string, string> = { '.': 'transparent' }
  for (const color of ordered) legend[keyFor.get(color) as string] = color

  const coverage = measureCoverage(source, { frame })

  return {
    width: w,
    height: h,
    hasAnimation: render.hasAnimation,
    frameCount: render.frameCount,
    paletteDeclared: render.palette,
    colorsPainted: ordered,
    coverage: {
      frame: Math.round(coverage.ratio * 100) / 100,
      maxAcrossFrames: Math.round(coverage.maxRatio * 100) / 100
    },
    bounds:
      minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    map,
    legend,
    note:
      `Each character is roughly ${step}x${step} source pixel(s), showing the dominant color of that ` +
      `region. This is a coarse read of layout and silhouette, not the artwork — the person looking ` +
      `at the page can see the real thing, so ask them about anything the map cannot settle.`
  }
}
