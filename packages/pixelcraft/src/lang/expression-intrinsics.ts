export const EXPRESSION_INTRINSICS = [
  'lerp',
  'ease_in_out',
  'clamp',
  'min',
  'max',
  'abs',
  'step',
  'smoothstep',
  'sin01',
  'cos01',
  'noise01'
] as const

export type ExpressionIntrinsicName = (typeof EXPRESSION_INTRINSICS)[number]

type ExpressionIntrinsicDefinition = {
  arity: number
  evaluate: (args: readonly number[]) => number
}

const clampValue = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

export const quantizeNoiseInput = (value: number): number => Math.trunc(value * 1024)

export const hashInt = (value: number): number => {
  let h = value | 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h | 0
}

export const hashCoordsToUnit = (x: number, y: number, seed: number): number => {
  const mixed = (
    Math.imul(x | 0, 0x1f123bb5) ^
    Math.imul(y | 0, 0x0593d5a7) ^
    Math.imul(seed | 0, 0x27d4eb2f)
  ) | 0
  return (hashInt(mixed) >>> 0) / 4294967296
}

export const sampleNoise01 = (x: number, y: number, seed: number): number => {
  const qx = quantizeNoiseInput(x)
  const qy = quantizeNoiseInput(y)
  const qs = quantizeNoiseInput(seed)
  return hashCoordsToUnit(qx, qy, qs)
}

const EXPRESSION_INTRINSIC_DEFINITIONS: Readonly<Record<ExpressionIntrinsicName, ExpressionIntrinsicDefinition>> = {
  lerp: {
    arity: 3,
    evaluate: (args) => args[0] + (args[1] - args[0]) * args[2]
  },
  ease_in_out: {
    arity: 1,
    evaluate: (args) => {
      const t = clampValue(args[0], 0, 1)
      return t * t * (3 - 2 * t)
    }
  },
  clamp: {
    arity: 3,
    evaluate: (args) => clampValue(args[0], args[1], args[2])
  },
  min: {
    arity: 2,
    evaluate: (args) => Math.min(args[0], args[1])
  },
  max: {
    arity: 2,
    evaluate: (args) => Math.max(args[0], args[1])
  },
  abs: {
    arity: 1,
    evaluate: (args) => Math.abs(args[0])
  },
  step: {
    arity: 2,
    evaluate: (args) => (args[1] < args[0] ? 0 : 1)
  },
  smoothstep: {
    arity: 3,
    evaluate: (args) => {
      const edge0 = args[0]
      const edge1 = args[1]
      const x = args[2]
      if (edge0 === edge1) {
        return x < edge0 ? 0 : 1
      }
      const t = clampValue((x - edge0) / (edge1 - edge0), 0, 1)
      return t * t * (3 - 2 * t)
    }
  },
  sin01: {
    arity: 1,
    evaluate: (args) => 0.5 + 0.5 * Math.sin(2 * Math.PI * args[0])
  },
  cos01: {
    arity: 1,
    evaluate: (args) => 0.5 + 0.5 * Math.cos(2 * Math.PI * args[0])
  },
  noise01: {
    arity: 3,
    evaluate: (args) => sampleNoise01(args[0], args[1], args[2])
  }
}

export function getExpressionIntrinsicArity(name: ExpressionIntrinsicName): number {
  return EXPRESSION_INTRINSIC_DEFINITIONS[name].arity
}

export function evaluateExpressionIntrinsic(name: ExpressionIntrinsicName, args: readonly number[]): number {
  const definition = EXPRESSION_INTRINSIC_DEFINITIONS[name]
  const normalizedArgs = args.slice(0, definition.arity)
  while (normalizedArgs.length < definition.arity) {
    normalizedArgs.push(0)
  }
  return definition.evaluate(normalizedArgs)
}
