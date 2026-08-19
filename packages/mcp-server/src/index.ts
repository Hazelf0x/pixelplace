/**
 * PixelCraft MCP server — the engine, handed to whatever model is calling.
 *
 * The design point: the *caller* is the artist. This server does not make model
 * calls of its own and needs no API key. It gives a Claude session the compiler,
 * the renderer, and the language's own docs, and then — the part that matters —
 * hands back the rendered image. A model that can see its own render can judge
 * whether the drawing is right, not merely whether it compiled. That closes the
 * one gap the server-side pipeline cannot: structural and palette correctness are
 * checkable in code, but "is this actually a slime" needs eyes.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  aiSystemPrompt,
  extractUsedColors,
  measureCoverage,
  renderAnimation,
  renderSetSheet,
  renderSource,
  renderSpriteSheet,
  validateSource,
  type Diagnostic
} from '@pixelplace/pixelcraft'

const VERSION = '0.1.0'

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/** Every tool returns this shape; `isError` marks a compile/render failure. */
function result(content: Content[], isError = false) {
  return { content, isError }
}

function textOnly(text: string, isError = false) {
  return result([{ type: 'text', text }], isError)
}

function formatDiagnostics(label: string, diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return ''
  return (
    `\n${label}:\n` +
    diagnostics
      .map((d) => `  ${d.code} at ${d.line}:${d.column} — ${d.message}${d.hint ? ` (${d.hint})` : ''}`)
      .join('\n')
  )
}

/**
 * Write a rendered asset to disk. Paths come from the calling model, so they are
 * resolved and reported back in full — the user should be able to see exactly
 * where a file landed.
 */
async function writeAsset(outputPath: string, bytes: Uint8Array): Promise<string> {
  const resolved = path.resolve(outputPath)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, bytes)
  return resolved
}

const server = new McpServer({ name: 'pixelcraft', version: VERSION })

// ---- The language itself ---------------------------------------------------

server.registerTool(
  'pixelcraft_guide',
  {
    title: 'PixelCraft language guide',
    description:
      'Return the PixelCraft authoring guide: syntax, commands, palettes, animation, and the ' +
      'common mistakes. Read this BEFORE writing PixelCraft for the first time in a session. ' +
      'The guide is generated from the language\'s own docs, so it never drifts from the compiler.',
    inputSchema: {}
  },
  async () => textOnly(aiSystemPrompt())
)

// ---- The cheap loop --------------------------------------------------------

server.registerTool(
  'pixelcraft_check',
  {
    title: 'Check PixelCraft without rendering',
    description:
      'Compile a PixelCraft program and report diagnostics, palette, the colors actually painted, ' +
      'and how much of the canvas is covered — without returning an image. Use this while ' +
      'iterating on syntax; it is far cheaper than pixelcraft_render. Note that "colors used" ' +
      'reflects the pixels painted, which can differ from the declared palette if the program ' +
      'contains inline hex literals.',
    inputSchema: {
      source: z.string().describe('The PixelCraft program.'),
      frame: z.number().int().min(0).optional().describe('Frame to inspect, for animated programs.')
    }
  },
  async ({ source, frame }) => {
    const validation = validateSource(source)
    if (!validation.ok) {
      return textOnly(`Does not compile.${formatDiagnostics('Errors', validation.errors)}`, true)
    }

    const rendered = renderSource(source, { frame: frame ?? 0 })
    if (!rendered.ok) {
      return textOnly(`Compiles, but fails at runtime.${formatDiagnostics('Errors', rendered.errors)}`, true)
    }

    // Both of these read every frame; `frame` only selects which one the
    // per-frame coverage figure describes. Saying so matters: "5 colors painted,
    // 0% coverage" looks self-contradictory until you know the two lines are
    // measuring different things.
    const used = extractUsedColors(source)
    const coverage = measureCoverage(source, { frame: frame ?? 0 })
    const animated = rendered.hasAnimation

    return textOnly(
      [
        'Valid.',
        `Canvas: ${rendered.width}x${rendered.height}`,
        rendered.hasAnimation ? `Frames: ${rendered.frameCount}` : 'Frames: still',
        `Declared palette (${rendered.palette.length}): ${rendered.palette.join(' ')}`,
        `Colors painted (${used.length}${animated ? ', across all frames' : ''}): ${used.join(' ')}`,
        `Coverage${animated ? ` of frame ${frame ?? 0}` : ''}: ${Math.round(coverage.ratio * 100)}% of the canvas ` +
          `(${coverage.painted}/${coverage.total} pixels). Unpainted pixels are transparent.`,
        animated && coverage.maxRatio !== coverage.ratio
          ? `Fullest frame covers ${Math.round(coverage.maxRatio * 100)}% of the canvas.`
          : '',
        formatDiagnostics('Warnings', rendered.warnings)
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
)

// ---- Rendering -------------------------------------------------------------

server.registerTool(
  'pixelcraft_render',
  {
    title: 'Render PixelCraft to a PNG',
    description:
      'Compile and render a PixelCraft program, returning the image so you can SEE it and judge ' +
      'whether the drawing is actually right — not just whether it compiled. Optionally writes ' +
      'the PNG to disk. For animated programs this renders one frame; use pixelcraft_animate for ' +
      'the whole loop.',
    inputSchema: {
      source: z.string().describe('The PixelCraft program.'),
      scale: z
        .number()
        .int()
        .min(1)
        .max(32)
        .optional()
        .describe('Integer upscale. Default 8 — small canvases are hard to see at true size.'),
      frame: z.number().int().min(0).optional().describe('Frame to render, for animated programs.'),
      outputPath: z.string().optional().describe('Write the PNG here as well as returning it.')
    }
  },
  async ({ source, scale, frame, outputPath }) => {
    const rendered = renderSource(source, { scale: scale ?? 8, frame: frame ?? 0 })
    if (!rendered.ok || !rendered.png) {
      return textOnly(`Render failed.${formatDiagnostics('Errors', rendered.errors)}`, true)
    }

    const facts = [
      `Rendered ${rendered.width}x${rendered.height}` +
        (rendered.hasAnimation ? ` (frame ${frame ?? 0} of ${rendered.frameCount})` : ' (still)'),
      `Palette (${rendered.palette.length}): ${rendered.palette.join(' ')}`,
      formatDiagnostics('Warnings', rendered.warnings)
    ]

    if (outputPath) {
      facts.push(`Written to ${await writeAsset(outputPath, rendered.png)}`)
    }

    return result([
      { type: 'text', text: facts.filter(Boolean).join('\n') },
      { type: 'image', data: Buffer.from(rendered.png).toString('base64'), mimeType: 'image/png' }
    ])
  }
)

server.registerTool(
  'pixelcraft_animate',
  {
    title: 'Render PixelCraft frames to an animated GIF',
    description:
      'Render every frame of an animated PixelCraft program (one that uses frame/frames/timeline) ' +
      'into a looping GIF. Returns the first frame as an image plus the animation facts, and ' +
      'writes the GIF to disk when given a path. A still program has no animation to give.',
    inputSchema: {
      source: z.string().describe('The PixelCraft program. Must declare frames.'),
      scale: z.number().int().min(1).max(32).optional().describe('Integer upscale. Default 8.'),
      fps: z.number().int().min(1).max(50).optional().describe('Playback rate. Default 12.'),
      outputPath: z.string().optional().describe('Write the GIF here.')
    }
  },
  async ({ source, scale, fps, outputPath }) => {
    const animated = renderAnimation(source, { scale: scale ?? 8, fps: fps ?? 12 })
    if (!animated.ok) {
      return textOnly(`Animation failed.${formatDiagnostics('Errors', animated.errors)}`, true)
    }
    if (!animated.hasAnimation || !animated.gif) {
      return textOnly(
        'This program is still — it declares no frames, so there is no animation to render. ' +
          'Add a `timeline 0..N { each { ... } }` block and drive movement with $frame.',
        true
      )
    }

    const facts = [
      `Animated ${animated.width}x${animated.height}, ${animated.frameCount} frames at ${animated.fps}fps.`,
      `Palette (${animated.palette.length}): ${animated.palette.join(' ')}`
    ]
    if (outputPath) {
      facts.push(`Written to ${await writeAsset(outputPath, animated.gif)}`)
    }

    // Show frame 0 so the caller can see what it looks like; a GIF content block
    // is not reliably animated in every client.
    const preview = renderSource(source, { scale: scale ?? 8, frame: 0 })
    const content: Content[] = [{ type: 'text', text: facts.join('\n') }]
    if (preview.ok && preview.png) {
      content.push({
        type: 'image',
        data: Buffer.from(preview.png).toString('base64'),
        mimeType: 'image/png'
      })
    }
    return result(content)
  }
)

server.registerTool(
  'pixelcraft_sheet',
  {
    title: 'Tile PixelCraft programs into a sprite sheet',
    description:
      'Build a sprite sheet on an exact, uniform grid — the form a game engine imports. ' +
      'mode "pieces" gives one cell per program (an icon set, a character\'s facings); ' +
      'mode "frames" expands the frames of a single animated program. Cells are padded to the ' +
      'largest member, so slicing by the reported cell size always lines up.',
    inputSchema: {
      sources: z.array(z.string()).min(1).describe('One PixelCraft program per cell, in order.'),
      mode: z
        .enum(['pieces', 'frames'])
        .optional()
        .describe('"pieces" (default) = one cell per source. "frames" = expand one source\'s frames.'),
      scale: z.number().int().min(1).max(32).optional().describe('Integer upscale. Default 8.'),
      columns: z.number().int().min(1).optional().describe('Cells per row. Default: a single strip.'),
      outputPath: z.string().optional().describe('Write the sheet PNG here.')
    }
  },
  async ({ sources, mode, scale, columns, outputPath }) => {
    const useFrames = mode === 'frames'
    if (useFrames && sources.length !== 1) {
      return textOnly('mode "frames" expands a single program — pass exactly one source.', true)
    }

    const sheet = useFrames
      ? renderSpriteSheet(sources[0], { scale: scale ?? 8, columns })
      : renderSetSheet(sources, { scale: scale ?? 8, columns })

    if (!sheet.ok || !sheet.png) {
      return textOnly(`Sheet failed.${formatDiagnostics('Errors', sheet.errors)}`, true)
    }

    const cells = useFrames
      ? (sheet as { frameCount: number }).frameCount
      : (sheet as { memberCount: number }).memberCount

    const facts = [
      `Sheet: ${sheet.columns}x${sheet.rows} grid, ${cells} cells.`,
      `Cell size: ${sheet.frameWidth}x${sheet.frameHeight} — slice on that boundary.`
    ]
    if (outputPath) {
      facts.push(`Written to ${await writeAsset(outputPath, sheet.png)}`)
    }

    return result([
      { type: 'text', text: facts.join('\n') },
      { type: 'image', data: Buffer.from(sheet.png).toString('base64'), mimeType: 'image/png' }
    ])
  }
)

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  // stdout is the protocol channel — diagnostics must go to stderr.
  console.error('pixelcraft-mcp failed to start:', error)
  process.exit(1)
})
