export const DEFAULT_CANVAS_WIDTH = 16
export const DEFAULT_CANVAS_HEIGHT = 16
export const MIN_CANVAS_DIMENSION = 1
export const MAX_CANVAS_DIMENSION = 256

export function isCanvasDimensionValid(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_CANVAS_DIMENSION && value <= MAX_CANVAS_DIMENSION
}

export function clampCanvasDimension(value: number): number {
  if (!Number.isFinite(value)) return MIN_CANVAS_DIMENSION
  return Math.max(MIN_CANVAS_DIMENSION, Math.min(MAX_CANVAS_DIMENSION, Math.trunc(value)))
}
