import * as gifencModule from 'gifenc'
import { HeadlessPixelCanvas } from './headless-canvas'
import { canvasToRgba } from './rgba'

// gifenc is CommonJS with `export default GIFEncoder`, and loaders disagree about
// what that means: Node's CJS interop hands back the whole exports object as the
// default, while bundlers hand back the GIFEncoder function alone. Neither a
// named nor a default import works in both, so pick whichever object carries the
// functions we need.
type GifencExports = {
  GIFEncoder: typeof gifencModule.GIFEncoder
  quantize: typeof gifencModule.quantize
  applyPalette: typeof gifencModule.applyPalette
}

const namespace = gifencModule as unknown as Record<string, unknown>
const gifenc = (
  typeof namespace.quantize === 'function' ? namespace : namespace.default
) as GifencExports

const { GIFEncoder, quantize, applyPalette } = gifenc

// GIF delays are stored in centiseconds, and most viewers treat anything under
// ~20ms as "unspecified" and silently slow it to 100ms. Clamp so we never land there.
const MIN_DELAY_MS = 20
const MAX_DELAY_MS = 5000

export interface GifEncodeOptions {
  /** Playback rate. Frame durations are already expanded into repeated frames. */
  fps?: number
  /** 0 = loop forever (the default for pixel art). */
  repeat?: number
}

/**
 * Encode a sequence of headless canvas snapshots into an animated GIF.
 *
 * One palette is quantized across *every* frame rather than per-frame: pixel-art
 * palettes are tiny, and a shared palette keeps colors from shifting between
 * frames (the classic GIF flicker) while letting frames share one color table.
 */
export function encodeFramesToGif(
  frames: Uint8Array[],
  width: number,
  height: number,
  options: GifEncodeOptions = {}
): Uint8Array {
  if (frames.length === 0) {
    throw new Error('encodeFramesToGif: no frames')
  }

  const fps = Math.max(1, Math.min(50, options.fps ?? 12))
  const delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(1000 / fps)))

  // Quantize once over the concatenated frames to get a single stable color table.
  const combined = new Uint8ClampedArray(frames.reduce((n, f) => n + f.length, 0))
  let offset = 0
  for (const frame of frames) {
    combined.set(frame, offset)
    offset += frame.length
  }

  // oneBitAlpha collapses partial alpha to fully on/off — GIF has no alpha channel,
  // only a single transparent palette index, so soft edges must resolve one way.
  const palette = quantize(combined, 255, { format: 'rgba4444', oneBitAlpha: true })
  const transparentIndex = palette.findIndex((entry) => entry.length >= 4 && entry[3] === 0)
  const hasTransparency = transparentIndex >= 0

  const gif = GIFEncoder()
  frames.forEach((frame, index) => {
    const indexed = applyPalette(new Uint8ClampedArray(frame), palette, 'rgba4444')
    gif.writeFrame(indexed, width, height, {
      // Only the first frame carries the palette: gifenc writes it as the global
      // color table then, and as a redundant per-frame local table afterwards.
      ...(index === 0 ? { palette, repeat: options.repeat ?? 0 } : {}),
      delay,
      transparent: hasTransparency,
      transparentIndex: hasTransparency ? transparentIndex : 0,
      // dispose 2 = restore to background before the next frame, so transparent
      // regions don't smear the previous frame behind them.
      dispose: hasTransparency ? 2 : -1
    } as Parameters<typeof gif.writeFrame>[3])
  })
  gif.finish()

  return gif.bytes()
}

/** Flatten the current canvas state into a frame buffer for {@link encodeFramesToGif}. */
export function captureFrame(canvas: HeadlessPixelCanvas, scale = 1): Uint8Array {
  return canvasToRgba(canvas, scale)
}
