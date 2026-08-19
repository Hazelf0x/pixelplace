import { StatementCommand } from './command-registry'

export interface DocsReferenceRow {
  commandCode: string
  descriptionHtml: string
  exampleCode: string
  commandKey?: StatementCommand
}

export const DOCS_REFERENCE_ROWS: Readonly<{
  setupDrawing: readonly DocsReferenceRow[]
  positioningComposition: readonly DocsReferenceRow[]
}> = {
  setupDrawing: [
    {
      commandKey: 'canvas',
      commandCode: 'canvas WxH',
      descriptionHtml: 'Required. Set canvas size (1..256 per side)',
      exampleCode: 'canvas 16x16'
    },
    {
      commandCode: 'version 0.1',
      descriptionHtml: 'Optional top-level language line pragma',
      exampleCode: 'version "0.1.x"'
    },
    {
      commandKey: 'pal',
      commandCode: 'pal ...',
      descriptionHtml: 'Define indexed or named palette',
      exampleCode: 'pal bg=#1a1c2c skin=#ef7d57'
    },
    {
      commandKey: 'pal',
      commandCode: 'pal :pico8 | :dawnbringer16 | :gameboy | :endesga32',
      descriptionHtml: 'Load a built-in palette preset',
      exampleCode: 'pal :pico8'
    },
    {
      commandKey: 'pal',
      commandCode: 'pal+ ...',
      descriptionHtml: 'Explicit palette append syntax',
      exampleCode: 'pal+ :gameboy ui=#f0f0f0'
    },
    {
      commandKey: 'pal',
      commandCode: 'pal name=#hex..#hex steps N',
      descriptionHtml: 'Gradient range (creates name0..nameN-1)',
      exampleCode: 'pal sky=#1a1c2c..#6eb5ff steps 5'
    },
    {
      commandKey: 'let',
      commandCode: 'let name = EXPR',
      descriptionHtml: 'Declare variable (<code>$name</code> to reference)',
      exampleCode: 'let size = 4'
    },
    {
      commandKey: 'const',
      commandCode: 'const name = EXPR',
      descriptionHtml: 'Declare semantic scalar symbol (forward refs supported in compiler flow)',
      exampleCode: 'const pulse = (sin01($t) * 4)'
    },
    {
      commandKey: 'letpair',
      commandCode: 'letpair name = PAIR_EXPR',
      descriptionHtml: 'Declare reusable pair alias',
      exampleCode: 'letpair spray = 8x4'
    },
    {
      commandKey: 'defpt',
      commandCode: 'defpt name = POINT_EXPR',
      descriptionHtml: 'Declare declarative point symbol (forward refs supported in compiler flow)',
      exampleCode: 'defpt flame = face +1,-1'
    },
    {
      commandKey: 'box',
      commandCode: 'box name X,Y WxH',
      descriptionHtml: 'Declare a named layout region with semantic points like <code>topLeft</code> and <code>center</code>',
      exampleCode: 'box hud 2,2 20x10'
    },
    {
      commandKey: 'box',
      commandCode: 'box name in parent dock POINT WxH [offset X,Y]',
      descriptionHtml: 'Dock a child layout region to a parent box edge/corner using matching semantic points',
      exampleCode: 'box footer in hud dock bottomRight 12x4 offset -2,-2'
    },
    {
      commandKey: 'layer',
      commandCode: 'layer "name"',
      descriptionHtml: 'Create/switch layer (first created = back)',
      exampleCode: 'layer "details"'
    },
    {
      commandKey: 'with',
      commandCode: 'with layer "name" [clear] { ... }',
      descriptionHtml: 'Scoped layer block (desugars to push/layer/body/pop)',
      exampleCode: 'with layer "fx" clear { glow center 6 aura }'
    },
    {
      commandKey: 'clear',
      commandCode: 'clear [COLOR|layer "name" [COLOR]]',
      descriptionHtml: 'Clear/fill active or named layer',
      exampleCode: 'clear layer "fx" #00000000'
    },
    {
      commandKey: 'font',
      commandCode: 'font "name" { glyph ... }',
      descriptionHtml: 'Bitmap font declaration (preamble)',
      exampleCode: 'font "tiny" { glyph "A" advance 4 { "11" "11" } }'
    },
    {
      commandKey: 'push',
      commandCode: 'push',
      descriptionHtml: 'Save drawing state (mirror, cursor, offset, color, layer)',
      exampleCode: 'push'
    },
    {
      commandKey: 'pop',
      commandCode: 'pop',
      descriptionHtml: 'Restore most recently saved state',
      exampleCode: 'pop'
    },
    {
      commandKey: 'px',
      commandCode: 'px X,Y COLOR',
      descriptionHtml: 'Pixel (supports multi-point)',
      exampleCode: 'px 0,0 4,4 8,8 1'
    },
    {
      commandKey: 'rect',
      commandCode: 'rect X,Y WxH COLOR',
      descriptionHtml: 'Filled rectangle',
      exampleCode: 'rect 2,2 4x6 2'
    },
    {
      commandKey: 'orect',
      commandCode: 'orect X,Y WxH COLOR',
      descriptionHtml: 'Rectangle outline',
      exampleCode: 'orect 2,2 4x6 trim'
    },
    {
      commandKey: 'line',
      commandCode: 'line X1,Y1 X2,Y2 COLOR',
      descriptionHtml: 'Line segment',
      exampleCode: 'line 0,0 15,15 1'
    },
    {
      commandKey: 'oline',
      commandCode: 'oline X1,Y1 X2,Y2 COLOR',
      descriptionHtml: 'Outline line segment',
      exampleCode: 'oline 0,1 15,1 glow'
    },
    {
      commandKey: 'circ',
      commandCode: 'circ X,Y R COLOR',
      descriptionHtml: 'Filled circle',
      exampleCode: 'circ 8,8 3 glow'
    },
    {
      commandKey: 'arc',
      commandCode: 'arc X,Y R START END COLOR',
      descriptionHtml: 'Clockwise arc stroke (0 degrees = +X)',
      exampleCode: 'arc 8,8 4 315 45 glow'
    },
    {
      commandKey: 'ocirc',
      commandCode: 'ocirc X,Y R COLOR',
      descriptionHtml: 'Circle outline',
      exampleCode: 'ocirc 8,8 3 glow'
    },
    {
      commandKey: 'ellipse',
      commandCode: 'ellipse X,Y RXxRY COLOR',
      descriptionHtml: 'Filled ellipse',
      exampleCode: 'ellipse 8,8 4x2 glow'
    },
    {
      commandKey: 'oellipse',
      commandCode: 'oellipse X,Y RXxRY COLOR',
      descriptionHtml: 'Ellipse outline',
      exampleCode: 'oellipse 8,8 4x2 glow'
    },
    {
      commandKey: 'poly',
      commandCode: 'poly X,Y ... COLOR',
      descriptionHtml: 'Filled polygon',
      exampleCode: 'poly 2,5 8,1 14,5 3'
    },
    {
      commandKey: 'opoly',
      commandCode: 'opoly X,Y ... COLOR',
      descriptionHtml: 'Polygon outline',
      exampleCode: 'opoly 2,5 8,1 14,5 3'
    },
    {
      commandKey: 'glow',
      commandCode: 'glow X,Y R COLOR',
      descriptionHtml: 'Radial glow (fades to transparent)',
      exampleCode: 'glow 8,8 4 #ffcd75'
    },
    {
      commandKey: 'dither',
      commandCode: 'dither checker|bayer|noise at X,Y WxH A B [seed N]',
      descriptionHtml: 'Two-color dither fill with deterministic mode/seed',
      exampleCode: 'dither noise at 0,0 16x16 bg fog seed 42'
    },
    {
      commandKey: 'fill',
      commandCode: 'fill X,Y COLOR',
      descriptionHtml: 'Flood fill',
      exampleCode: 'fill 0,0 bg'
    },
    {
      commandKey: 'color',
      commandCode: 'color COLOR',
      descriptionHtml: 'Set current color for following commands',
      exampleCode: 'color skin'
    },
    {
      commandKey: 'text',
      commandCode: 'text "..." at X,Y font "name" color C',
      descriptionHtml: 'Render bitmap text (supports align/tracking/lineHeight/wrap)',
      exampleCode: 'text "HELLO" at 2,2 font "tiny" color skin align center'
    }
  ],
  positioningComposition: [
    {
      commandCode: 'center',
      descriptionHtml: 'Canvas center keyword',
      exampleCode: 'circ center 4 1'
    },
    {
      commandCode: '+X,+Y',
      descriptionHtml: 'Relative coordinate from cursor',
      exampleCode: 'px +1,+0 2'
    },
    {
      commandKey: 'cursor',
      commandCode: 'cursor X,Y',
      descriptionHtml: 'Set cursor position manually',
      exampleCode: 'cursor 8,8'
    },
    {
      commandKey: 'anchor',
      commandCode: 'anchor name X,Y',
      descriptionHtml: 'Name semantic positions',
      exampleCode: 'anchor face 8,6'
    },
    {
      commandKey: 'mirror',
      commandCode: 'mirror :x|:y|:xy|off',
      descriptionHtml: 'Symmetry mode',
      exampleCode: 'mirror :x'
    },
    {
      commandKey: 'group',
      commandCode: 'group "name" [pivot X,Y] { ... }',
      descriptionHtml: 'Reusable code block with optional stamp pivot',
      exampleCode: 'group "eye" pivot 1,1 { px 0,0 1 }'
    },
    {
      commandKey: 'bitmap',
      commandCode: 'bitmap "name" [pivot X,Y] { ... }',
      descriptionHtml: 'ASCII sprite definition with optional stamp pivot',
      exampleCode: 'bitmap "spark" pivot 1,1 { ".1." "111" ".1." }'
    },
    {
      commandKey: 'tileset',
      commandCode: 'tileset "name" tileSize WxH [seed N] { tile ... [weight N] }',
      descriptionHtml: 'Tile symbol library for tilemaps (preamble, supports deterministic symbol variants)',
      exampleCode: 'tileset "terrain" tileSize 8x8 seed 7 { tile "W" "window_off" weight 4 tile "W" "window_on" weight 1 }'
    },
    {
      commandKey: 'tilemap',
      commandCode: 'tilemap "name" from "tileset" { ... }',
      descriptionHtml: 'Grid layout of tile symbols (preamble)',
      exampleCode: 'tilemap "field" from "terrain" { "GGSS" "G..S" }'
    },
    {
      commandKey: 'stamp',
      commandCode: 'stamp "name" at X,Y [opacity A]',
      descriptionHtml: 'Place group/bitmap',
      exampleCode: 'stamp "spark" at 4,2'
    },
    {
      commandKey: 'stamp',
      commandCode: 'stamp "name" at X,Y :flipx :flipy',
      descriptionHtml: 'Place stamp with flip',
      exampleCode: 'stamp "arrow" at 4,2 :flipx'
    },
    {
      commandKey: 'stamp',
      commandCode: 'stamp "name" at X,Y :rot90',
      descriptionHtml: 'Place stamp with rotation (90/180/270)',
      exampleCode: 'stamp "arrow" at 4,2 :rot90'
    },
    {
      commandKey: 'stamp',
      commandCode: 'stamp "name" at X,Y :center',
      descriptionHtml: 'Center bitmap footprint on target point',
      exampleCode: 'stamp "arrow" at center :center'
    },
    {
      commandKey: 'stamp',
      commandCode: 'stamp "name" at X,Y :pivot',
      descriptionHtml: 'Align the target\'s declared pivot to the target point',
      exampleCode: 'stamp "icon_sword" at 12,12 :pivot'
    },
    {
      commandKey: 'repeat',
      commandCode: 'repeat N step DxDy { ... }',
      descriptionHtml: 'Offset loop (<code>$i</code> = 0..N-1 inside)',
      exampleCode: 'repeat 4 step 2x0 { px 0,0 1 }'
    },
    {
      commandKey: 'timeline',
      commandCode: 'timeline A..B { each { ... } range C..D { ... } at N,M { ... } every N [offset O] { ... } }',
      descriptionHtml: 'Compact animation timeline that expands to frames',
      exampleCode: 'timeline 0..7 { each { px ($frameNumber,0) 1 } }'
    },
    {
      commandKey: 'tile',
      commandCode: 'tile "name" at X,Y WxH [step WxH]',
      descriptionHtml: 'Region tiling (supports transforms)',
      exampleCode: 'tile "grass" at 0,0 32x32'
    },
    {
      commandKey: 'map',
      commandCode: 'map "tilemap" at X,Y',
      descriptionHtml: 'Render a tilemap using its tileset symbols',
      exampleCode: 'map "field" at 0,0'
    },
    {
      commandKey: 'scatter',
      commandCode: 'scatter "name" in X,Y WxH count N seed S',
      descriptionHtml: 'Random stamp placement (seeded PRNG)',
      exampleCode: 'scatter "star" in 0,0 32x32 count 20 seed 42'
    },
    {
      commandKey: 'emit',
      commandCode: 'emit "name" at X,Y [count N] [spread WxH] [drift DXxDY] [time T] [vel VXxVY] [jitter JXxJY] [active A..B] [life L] [loop N] [fade] [seed S]',
      descriptionHtml: 'Seeded particle-like stamps with optional per-frame drift',
      exampleCode: 'emit "spark" at 8,8 count 10 spread 6x4 drift -1x0 time ($frame - 3) vel -1x0 jitter 2x1 life 6 loop 24 fade seed 42'
    }
  ]
}

export const DOCS_ADDITIONAL_NOTES: Readonly<{
  useThisViewFor: readonly string[]
  coreSemanticsHtml: readonly string[]
  maintenanceCommands: readonly string[]
}> = {
  useThisViewFor: [
    'Learning command flow quickly (setup -> draw -> compose -> animate).',
    'Copying runnable snippets into the editor.',
    'Browsing tested examples by category.'
  ],
  coreSemanticsHtml: [
    'Version pragma is optional and top-level only (<code>version 0.1</code> or quoted variants like <code>"0.1.x"</code>).',
    'Palette indices are strict: <code>0..(palette_length-1)</code>; out-of-range values emit runtime errors and fall back to <code>0</code>.',
    'Default bitmap index chars are <code>0-9</code>, <code>a-z</code>, and <code>A-Z</code> (indices <code>0..61</code>).',
    'Declaration names cannot reuse reserved keywords (for example <code>drift</code>); prefer names like <code>driftVec</code> or <code>delta</code>.',
    '<code>center</code> behavior depends on command type; for visual stamp centering, use <code>stamp ... :center</code>.',
    'Declare <code>pivot X,Y</code> on a <code>group</code> or <code>bitmap</code>, then use <code>stamp ... :pivot</code> for semantic alignment (great for icons and HUD parts).',
    'Transforms apply to both bitmap and group stamps; flips are applied before rotation.',
    'Editor bitmap local commit supports direct <code>stamp</code> placements (including transforms), scoped static <code>repeat</code> tracing, and scoped static <code>tile</code> tracing. <code>scatter</code>/<code>emit</code>, group-nested stamp paths, and unresolved/oversized repeat/tile expansions remain unsupported in v1.',
    'Editor tilemap paint mode supports <code>Target = Tilemap ...</code> with direct <code>map</code>-instance picking, brush/erase cell edits, and source-mapped row commit. Group-nested map paths are currently not selectable for pointer painting.',
    'Bitmap-target commit edits the shared bitmap source; the instance picker chooses mapping origin only, not a per-instance sprite clone.',
    '<code>emit</code> is stateless per frame and deterministic for the same seed + frame/time/loop inputs.',
    'Inside <code>frame</code>/<code>frames</code>, keep <code>canvas</code>, <code>pal</code>, <code>group</code>, <code>bitmap</code>, <code>tileset</code>, and <code>tilemap</code> in preamble.'
  ],
  maintenanceCommands: [
    'npm run docs:sync',
    'npm test'
  ]
}

const AI_DRAWING_COMMANDS: readonly StatementCommand[] = [
  'px',
  'rect',
  'line',
  'circ',
  'arc',
  'ellipse',
  'poly',
  'dither',
  'fill',
  'glow',
  'color'
]

const AI_OUTLINE_COMMANDS: readonly StatementCommand[] = [
  'orect',
  'oline',
  'ocirc',
  'oellipse',
  'opoly'
]

const AI_COMPOSITION_COMMANDS: readonly StatementCommand[] = [
  'anchor',
  'box',
  'cursor',
  'mirror',
  'with',
  'group',
  'bitmap',
  'stamp',
  'repeat',
  'timeline',
  'tile',
  'tileset',
  'tilemap',
  'map',
  'emit'
]

const AI_COMMAND_LABEL_OVERRIDES: Partial<Record<StatementCommand, string>> = {
  mirror: 'mirror :x/:y/:xy/off'
}

export const AI_PROMPT_COMMAND_GROUPS: Readonly<{
  drawing: readonly StatementCommand[]
  outline: readonly StatementCommand[]
  composition: readonly StatementCommand[]
}> = {
  drawing: AI_DRAWING_COMMANDS,
  outline: AI_OUTLINE_COMMANDS,
  composition: AI_COMPOSITION_COMMANDS
}

function formatCommandList(commands: readonly StatementCommand[]): string {
  return commands
    .map((command) => AI_COMMAND_LABEL_OVERRIDES[command] ?? command)
    .join(', ')
}

export function buildAIPromptText(): string {
  const lines = [
    'You are writing PixelCraft code.',
    '',
    'Goals:',
    '1) Return valid PixelCraft only.',
    '2) Use a named palette for readability.',
    '3) Draw base shapes first, then symmetric details with mirror.',
    '',
    'Required structure:',
    '- version 0.1                  # optional; top-level only',
    '- canvas WxH',
    '- pal :preset                  # optional preset (pico8/dawnbringer16/gameboy/endesga32)',
    '- pal+ name=#hex ...           # explicit append form',
    '- pal name=#hex name=#hex ...',
    '- pal name=#hex..#hex steps N   # gradient range (creates name0..nameN-1)',
    '- clear layering (background -> main forms -> details)',
    '',
    'Variables and expressions:',
    'let size = 4                    # declare variable',
    'const pulse = ($size + 2)       # declarative scalar symbol (compile-time forward refs)',
    'letpair spray = 8x4             # declare reusable pair alias',
    'defpt flame = face +1,-1        # declarative point symbol',
    'box hud 2,2 20x10               # named layout region',
    'box footer in hud dock bottomRight 12x4 offset -2,-2',
    '# Declaration names cannot reuse reserved keywords (e.g. avoid "drift"; use driftVec/delta).',
    'px ($size + 2, $size - 1) 1    # reference with $name',
    'rect (2 + $size),(1 + $size) 4x2 1  # per-axis wrapped expressions stay absolute',
    'ellipse 8,8 ($size) x ($size + 2) 1 # sizes/radii from expressions need an explicit x',
    '# A lone size is square: rect 4,4 6 1 draws 6x6. So write "(a) x (b)" - never "(a) (b)".',
    '# Supports + - * / % and parentheses, decimals, plus lerp(a,b,t), ease_in_out(t), clamp(x,lo,hi), min(a,b), max(a,b), abs(x), step(edge,x), smoothstep(edge0,edge1,x), sin01(t), cos01(t), and noise01(x,y,seed).',
    '# Canvas built-ins: $width, $height, $centerX, $centerY. $i is available in repeat.',
    '',
    'Drawing commands (all accept palette index, #hex, or named color):',
    formatCommandList(AI_DRAWING_COMMANDS),
    `Outline variants: ${formatCommandList(AI_OUTLINE_COMMANDS)}`,
    '',
    'Composition tools:',
    formatCommandList(AI_COMPOSITION_COMMANDS),
    '# Anchor offset shorthand (single-position slots): rect face +1,-1 2x2 ink',
    '# Box point shorthand: stamp "gem" at box hud topRight +0,+1',
    '',
    'Tiles and maps (one drawing repeated over a grid):',
    'tileset "terrain" tileSize 8x8 { tile "g" "grass" tile "w" "water" weight 2 }',
    '# Each tile maps a ONE-CHARACTER symbol to an existing group/bitmap name.',
    'tilemap "field" from "terrain" { "ggwg" "gwwg" }  # rows must be equal width; "." = empty cell',
    'map "field" at 0,0                  # tilemap declares the grid, map draws it',
    'tile "grass" at 0,0 32x16 step 8x8  # fill a region with one target; step is REQUIRED for groups',
    '',
    'Text and bitmap fonts:',
    'font "tiny" { glyph "A" advance 4 { "11" "11" } }',
    'text "HELLO" at X,Y font "tiny" color ink align center tracking 1 wrap 20 lineHeight 6',
    '',
    'Stamp transforms (bitmap/group):',
    'stamp "name" at X,Y :flipx        # horizontal flip',
    'stamp "name" at X,Y :flipy        # vertical flip',
    'stamp "name" at X,Y :rot90        # rotate 90 degrees clockwise',
    'stamp "name" at X,Y :rot180       # rotate 180 degrees',
    'stamp "name" at X,Y :rot270       # rotate 270 degrees clockwise',
    'stamp "name" at X,Y :center       # center stamp footprint on target point',
    'stamp "name" at X,Y :pivot        # align the target-defined pivot to the point',
    'stamp "name" at X,Y opacity 0.5   # per-stamp opacity, clamped to 0..1',
    'group "name" pivot X,Y { ... }    # declare a reusable semantic placement point',
    'bitmap "name" pivot X,Y { ... }   # declare a sprite placement point',
    'bitmap "ember" map s=spark o=transparent { "oso" "sss" }  # map clause precedes the {',
    '# Flips applied before rotation. Combine freely.',
    '',
    'Scatter (random placement):',
    'scatter "name" in X,Y WxH count N seed S',
    '# Seeded PRNG - same seed + count = same layout.',
    '',
    'Emit (seeded particles):',
    'emit "name" at X,Y count N spread WxH drift DXxDY time T vel VXxVY jitter JXxJY active A..B life L loop N fade seed S',
    '# Stateless per frame; loop wraps local time and phases particles deterministically for seamless loops.',
    '',
    'Layers and state:',
    'layer "name"     # create/switch layer (first created = back)',
    'with layer "name" [clear] { ... }  # scoped layer block',
    'push             # save state (mirror, cursor, offset, color, layer)',
    'pop              # restore state',
    '',
    'Animation:',
    '- Use frame N { ... }, frames A..B { ... }, or timeline A..B { each/range/at/every ... } (all support optional duration D)',
    '- Built-ins inside frames: $frame, $frameNumber, $frameCount (plus canvas built-ins)',
    '- Timeline clauses also provide $t, $localFrame, and $localT',
    '- timeline DECLARES its own frames. Do not also write frames A..B around it, or the',
    '  frame count doubles and every frame reports as duplicated and empty.',
    '- Prefer expressions over hand-written frames: one timeline driven by $localT/$frame',
    '  beats eight near-identical frame blocks, and stays editable.',
    '- Keep canvas/pal/group/bitmap in preamble (before frames)',
    '- layer/with/push/pop work inside frames',
    '',
    'Critical best practices:',
    '- Draw base shapes WITHOUT mirror, enable mirror only for symmetric details',
    '- Use rect (not fill) in frames to repaint specific zones',
    '- Use with-layer scopes or push/pop for temporary state changes (layer, mirror, color)',
    '',
    'Output style:',
    '- Add short comments for major sections',
    '- Prefer named colors over numeric indices when possible'
  ]

  return lines.join('\n')
}
