declare module 'gifenc' {
  export type GifencFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface QuantizeOptions {
    format?: GifencFormat
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaThreshold?: number
    clearAlphaColor?: number
  }

  export interface WriteFrameOptions {
    palette: number[][]
    first?: boolean
    transparent?: boolean
    transparentIndex?: number
    delay?: number
    repeat?: number
    colorDepth?: number
    dispose?: number
  }

  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions
    ): void
    finish(): void
    bytes(): Uint8Array
  }

  export function GIFEncoder(): GIFEncoderInstance
  export function quantize(rgba: Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): number[][]
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][], format?: GifencFormat): Uint8Array

  const gifenc: {
    GIFEncoder: typeof GIFEncoder
    quantize: typeof quantize
    applyPalette: typeof applyPalette
  }
  // gifenc ships CommonJS with no "exports" map, so Node's ESM loader cannot
  // detect its named exports. Import the default and destructure instead.
  export default gifenc
}
