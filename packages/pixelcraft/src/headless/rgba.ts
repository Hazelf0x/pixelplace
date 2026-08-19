import { parseHexColorLiteral } from '../lang/hex-color'
import { HeadlessPixelCanvas } from './headless-canvas'

/**
 * Flatten a headless canvas to a scaled RGBA buffer.
 *
 * Pixels the program never touched are genuinely transparent (0,0,0,0) — the
 * canvas is a sparse map, and "unset" means "nothing was drawn here", not
 * "black". Encoders decide how to present that; both PNG and GIF carry alpha.
 */
export function canvasToRgba(canvas: HeadlessPixelCanvas, scale = 1): Uint8Array {
  const safeScale = Math.max(1, Math.floor(scale))
  const { width, height } = canvas.getSize()
  const outWidth = width * safeScale
  const outHeight = height * safeScale
  const palette = canvas.getPalette()
  const rgba = new Uint8Array(outWidth * outHeight * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = canvas.getPixel(x, y)
      const parsed = color
        ? parseHexColorLiteral(
            color.type === 'index' ? palette[Number(color.value)] ?? '#000000' : String(color.value)
          ) ?? [0, 0, 0, 255]
        : [0, 0, 0, 0]

      for (let sy = 0; sy < safeScale; sy++) {
        const rowStart = (y * safeScale + sy) * outWidth
        for (let sx = 0; sx < safeScale; sx++) {
          const outIndex = (rowStart + x * safeScale + sx) * 4
          rgba[outIndex] = parsed[0]
          rgba[outIndex + 1] = parsed[1]
          rgba[outIndex + 2] = parsed[2]
          rgba[outIndex + 3] = parsed[3]
        }
      }
    }
  }

  return rgba
}
