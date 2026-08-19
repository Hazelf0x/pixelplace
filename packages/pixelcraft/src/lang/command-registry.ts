// Canonical PixelCraft language keywords and statement-level commands.
// Keep this file as the single source of truth and import from it
// anywhere command/keyword lists are needed.

import { EXPRESSION_INTRINSICS, type ExpressionIntrinsicName } from './expression-intrinsics'

export const STATEMENT_COMMANDS = [
  'canvas',
  'include',
  'pal',
  'px',
  'rect',
  'line',
  'oline',
  'circ',
  'arc',
  'mirror',
  'group',
  'stamp',
  'repeat',
  'poly',
  'fill',
  'frame',
  'frames',
  'timeline',
  'let',
  'const',
  'letpair',
  'letvec',
  'letsz',
  'defpt',
  'letpt',
  'anchor',
  'box',
  'bitmap',
  'font',
  'color',
  'clear',
  'cursor',
  'tile',
  'tileset',
  'tilemap',
  'map',
  'text',
  'layer',
  'with',
  'push',
  'pop',
  'offset',
  'fade',
  'orect',
  'ocirc',
  'opoly',
  'scatter',
  'emit',
  'glow',
  'ellipse',
  'oellipse',
  'dither'
] as const

export type StatementCommand = (typeof STATEMENT_COMMANDS)[number]

export type CoordinateMode = 'absolute' | 'relative' | 'anchor' | 'center'

export interface CoordinateCapabilities {
  absolute: boolean
  relative: boolean
  anchor: boolean
  center: boolean
}

const NO_COORDINATES: CoordinateCapabilities = {
  absolute: false,
  relative: false,
  anchor: false,
  center: false
}

const ALL_COORDINATE_MODES: CoordinateCapabilities = {
  absolute: true,
  relative: true,
  anchor: true,
  center: true
}

export const GRAMMAR_KEYWORDS = [
  'version',
  'at',
  'every',
  'offset',
  'dock',
  'dx',
  'dy',
  'center',
  'duration',
  'each',
  'range',
  'off',
  'step',
  'steps',
  'in',
  'count',
  'seed',
  'spread',
  'drift',
  'time',
  'loop',
  'vel',
  'jitter',
  'active',
  'life',
  'fade',
  'opacity',
  'map',
  'from',
  'tileSize',
  'weight'
] as const

export type ExpressionIntrinsic = ExpressionIntrinsicName

export const RESERVED_WORDS: readonly string[] = [
  ...STATEMENT_COMMANDS,
  ...GRAMMAR_KEYWORDS,
  ...EXPRESSION_INTRINSICS
]

export const COMMAND_COORDINATE_CAPABILITIES: Readonly<Record<StatementCommand, CoordinateCapabilities>> = {
  canvas: NO_COORDINATES,
  include: NO_COORDINATES,
  pal: NO_COORDINATES,
  mirror: NO_COORDINATES,
  group: NO_COORDINATES,
  repeat: NO_COORDINATES,
  frame: NO_COORDINATES,
  frames: NO_COORDINATES,
  timeline: NO_COORDINATES,
  let: NO_COORDINATES,
  const: NO_COORDINATES,
  letpair: NO_COORDINATES,
  letvec: NO_COORDINATES,
  letsz: NO_COORDINATES,
  defpt: NO_COORDINATES,
  letpt: NO_COORDINATES,
  bitmap: NO_COORDINATES,
  font: NO_COORDINATES,
  color: NO_COORDINATES,
  clear: NO_COORDINATES,
  layer: NO_COORDINATES,
  with: NO_COORDINATES,
  push: NO_COORDINATES,
  pop: NO_COORDINATES,
  offset: NO_COORDINATES,
  fade: NO_COORDINATES,

  anchor: {
    absolute: true,
    relative: false,
    anchor: false,
    center: false
  },

  box: ALL_COORDINATE_MODES,

  px: ALL_COORDINATE_MODES,
  rect: ALL_COORDINATE_MODES,
  line: ALL_COORDINATE_MODES,
  oline: ALL_COORDINATE_MODES,
  circ: ALL_COORDINATE_MODES,
  arc: ALL_COORDINATE_MODES,
  stamp: ALL_COORDINATE_MODES,
  poly: ALL_COORDINATE_MODES,
  fill: ALL_COORDINATE_MODES,
  cursor: ALL_COORDINATE_MODES,
  tile: ALL_COORDINATE_MODES,
  map: ALL_COORDINATE_MODES,
  scatter: ALL_COORDINATE_MODES,
  emit: ALL_COORDINATE_MODES,
  text: ALL_COORDINATE_MODES,
  orect: ALL_COORDINATE_MODES,
  ocirc: ALL_COORDINATE_MODES,
  opoly: ALL_COORDINATE_MODES,
  glow: ALL_COORDINATE_MODES,
  ellipse: ALL_COORDINATE_MODES,
  oellipse: ALL_COORDINATE_MODES,
  dither: ALL_COORDINATE_MODES,

  tileset: NO_COORDINATES,
  tilemap: NO_COORDINATES
}

const STATEMENT_COMMAND_SET = new Set<string>(STATEMENT_COMMANDS)
const RESERVED_WORD_SET = new Set<string>(RESERVED_WORDS)
const EXPRESSION_INTRINSIC_SET = new Set<string>(EXPRESSION_INTRINSICS)

export function isStatementCommand(value: string): value is StatementCommand {
  return STATEMENT_COMMAND_SET.has(value)
}

export function isReservedWord(value: string): boolean {
  return RESERVED_WORD_SET.has(value)
}

export function isExpressionIntrinsic(value: string): value is ExpressionIntrinsic {
  return EXPRESSION_INTRINSIC_SET.has(value)
}

export function supportsCoordinateMode(command: StatementCommand, mode: CoordinateMode): boolean {
  return COMMAND_COORDINATE_CAPABILITIES[command][mode]
}
