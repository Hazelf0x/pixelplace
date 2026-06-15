import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export interface GifExportOptions {
  fps: number
  width: number
  height: number
}

export async function exportGif(
  frames: ImageData[],
  options: GifExportOptions
): Promise<Blob> {
  const { fps, width, height } = options
  const delay = Math.round(1000 / fps) // ms per frame

  const gif = GIFEncoder()

  for (const frame of frames) {
    // Quantize colors to 256-color palette with alpha support
    const palette = quantize(frame.data, 256, { format: 'rgba4444' })
    // Apply palette to get indexed pixels
    const indexed = applyPalette(frame.data, palette, 'rgba4444')

    const transparentIndex = palette.findIndex((entry) => entry.length >= 4 && entry[3] === 0)
    const hasTransparency = transparentIndex >= 0

    // Write frame
    gif.writeFrame(indexed, width, height, {
      palette,
      delay,
      transparent: hasTransparency,
      transparentIndex: hasTransparency ? transparentIndex : 0
    })
  }

  gif.finish()

  const bytes = gif.bytes()
  // Convert to ArrayBuffer for Blob compatibility
  const buffer = new Uint8Array(bytes).buffer
  return new Blob([buffer], { type: 'image/gif' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
