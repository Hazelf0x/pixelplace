import { parseHexColorLiteral } from '../lang/hex-color'
import { HeadlessPixelCanvas } from './headless-canvas'

declare const require: {
  (name: string): unknown
}

const zlib = require('node:zlib') as {
  deflateSync: (data: Uint8Array) => Uint8Array
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

export function encodeCanvasToPng(canvas: HeadlessPixelCanvas, scale = 1): Uint8Array {
  const safeScale = Math.max(1, Math.floor(scale))
  const { width, height } = canvas.getSize()
  const outWidth = width * safeScale
  const outHeight = height * safeScale
  const palette = canvas.getPalette()
  const rgba = new Uint8Array(outWidth * outHeight * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = canvas.getPixel(x, y)
      const hex = color
        ? color.type === 'index'
          ? palette[Number(color.value)] ?? '#000000'
          : String(color.value)
        : '#000000'
      const parsed = parseHexColorLiteral(hex) ?? [0, 0, 0, 255]

      for (let sy = 0; sy < safeScale; sy++) {
        for (let sx = 0; sx < safeScale; sx++) {
          const outIndex = ((y * safeScale + sy) * outWidth + (x * safeScale + sx)) * 4
          rgba[outIndex] = parsed[0]
          rgba[outIndex + 1] = parsed[1]
          rgba[outIndex + 2] = parsed[2]
          rgba[outIndex + 3] = parsed[3]
        }
      }
    }
  }

  const scanlines = new Uint8Array((outWidth * 4 + 1) * outHeight)
  for (let y = 0; y < outHeight; y++) {
    const rowStart = y * (outWidth * 4 + 1)
    scanlines[rowStart] = 0
    scanlines.set(rgba.subarray(y * outWidth * 4, (y + 1) * outWidth * 4), rowStart + 1)
  }

  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, outWidth)
  ihdrView.setUint32(4, outHeight)
  ihdr[8] = 8
  ihdr[9] = 6

  const idat = zlib.deflateSync(scanlines)

  return concatBytes(
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', idat),
    buildChunk('IEND', new Uint8Array(0))
  )
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const lengthBytes = new Uint8Array(4)
  new DataView(lengthBytes.buffer).setUint32(0, data.length)

  const crcInput = concatBytes(typeBytes, data)
  const crcBytes = new Uint8Array(4)
  new DataView(crcBytes.buffer).setUint32(0, crc32(crcInput))

  return concatBytes(lengthBytes, typeBytes, data, crcBytes)
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
})()
