const PALETTE_PRESETS = {
  pico8: [
    '#000000',
    '#1d2b53',
    '#7e2553',
    '#008751',
    '#ab5236',
    '#5f574f',
    '#c2c3c7',
    '#fff1e8',
    '#ff004d',
    '#ffa300',
    '#ffec27',
    '#00e436',
    '#29adff',
    '#83769c',
    '#ff77a8',
    '#ffccaa'
  ],
  dawnbringer16: [
    '#140c1c',
    '#442434',
    '#30346d',
    '#4e4a4e',
    '#854c30',
    '#346524',
    '#d04648',
    '#757161',
    '#597dce',
    '#d27d2c',
    '#8595a1',
    '#6daa2c',
    '#d2aa99',
    '#6dc2ca',
    '#dad45e',
    '#deeed6'
  ],
  gameboy: [
    '#0f380f',
    '#306230',
    '#8bac0f',
    '#9bbc0f'
  ],
  endesga32: [
    '#be4a2f',
    '#d77643',
    '#ead4aa',
    '#e4a672',
    '#b86f50',
    '#733e39',
    '#3e2731',
    '#a22633',
    '#e43b44',
    '#f77622',
    '#feae34',
    '#fee761',
    '#63c74d',
    '#3e8948',
    '#265c42',
    '#193c3e',
    '#124e89',
    '#0099db',
    '#2ce8f5',
    '#ffffff',
    '#c0cbdc',
    '#8b9bb4',
    '#5a6988',
    '#3a4466',
    '#262b44',
    '#181425',
    '#ff0044',
    '#68386c',
    '#b55088',
    '#f6757a',
    '#e8b796',
    '#c28569'
  ]
} as const

export type PalettePresetName = keyof typeof PALETTE_PRESETS

export const PALETTE_PRESET_NAMES: readonly PalettePresetName[] = Object.freeze([
  'pico8',
  'dawnbringer16',
  'gameboy',
  'endesga32'
])

export function listPalettePresetNames(): readonly PalettePresetName[] {
  return PALETTE_PRESET_NAMES
}

export function lookupPalettePreset(name: string): readonly string[] | null {
  const normalized = name.trim().toLowerCase() as PalettePresetName
  const preset = PALETTE_PRESETS[normalized]
  return preset ? preset : null
}
