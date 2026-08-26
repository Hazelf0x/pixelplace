// The WebMCP tool surface for the Studio.
//
// Design rule: every tool answers a question an agent can act on, and none of them
// pretend the agent can see. The split is deliberate —
//
//   the agent owns STRUCTURE   grammar, palette compliance, frame counts, coverage,
//                              silhouette. All of it checkable in text.
//   the human owns TASTE       whether the drawing is any good, and whether it is
//                              a drawing of the thing that was asked for.
//
// That is not a limitation we are working around. An image model cannot hold a grid
// and an agent cannot hold a mouse, but an agent can write a program — and a program
// compiles to an exact canvas with a locked palette and frames that line up. This
// tool surface is what makes that collaboration concrete.
import {
  aiSystemPrompt,
  extractUsedColors,
  measureCoverage,
  renderToRgba,
  validateSource
} from '@pixelplace/pixelcraft/browser'
import { describeRender } from './render-client'
import { fail, ok, type WebMcpTool } from './webmcp'
import { GALLERY, findEntry, loadExampleSource } from './gallery'

/** What a tool needs from the live Studio. Implemented over refs, so tools register once. */
export interface StudioApi {
  getSource: () => string
  setSource: (source: string) => void
  getFrame: () => number
  setFrame: (frame: number) => void
  setPlaying: (playing: boolean) => void
  exportArtwork: (format: 'png' | 'gif' | 'source', scale: number) => Promise<string>
}

/** One line in the activity feed the human watches while an agent works. */
export interface ActivityEntry {
  id: number
  tool: string
  detail: string
  at: number
  ok: boolean
}

const MAX_SOURCE_LENGTH = 60_000

/** Compile a candidate and summarise everything checkable about it, in one shape. */
function inspect(source: string) {
  const validation = validateSource(source)
  if (!validation.ok) {
    return {
      compiles: false as const,
      errors: validation.errors.map((e) => ({
        code: e.code,
        line: e.line,
        column: e.column,
        message: e.message,
        ...(e.hint ? { hint: e.hint } : {})
      }))
    }
  }

  const render = renderToRgba(source)
  if (!render.ok) {
    return {
      compiles: false as const,
      errors: render.errors.map((e) => ({ code: e.code, line: e.line, column: e.column, message: e.message }))
    }
  }

  const coverage = measureCoverage(source)
  return {
    compiles: true as const,
    canvas: { width: render.sourceWidth, height: render.sourceHeight },
    animation: render.hasAnimation ? { frames: render.frameCount } : null,
    paletteDeclared: render.palette,
    // Deliberately different from the declared palette: a program can declare the
    // palette it was handed and still paint a raw hex literal. Enforcing a locked
    // palette means reading pixels, not declarations.
    colorsPainted: extractUsedColors(source),
    coverage: {
      frame0: Math.round(coverage.ratio * 100) / 100,
      maxAcrossFrames: Math.round(coverage.maxRatio * 100) / 100
    },
    warnings: render.warnings.map((w) => ({
      code: w.code,
      line: w.line,
      message: w.message,
      ...(w.hint ? { hint: w.hint } : {})
    }))
  }
}

export function createStudioTools(api: StudioApi, log: (tool: string, detail: string, ok: boolean) => void): WebMcpTool[] {
  const note = (tool: string, detail: string, succeeded = true) => log(tool, detail, succeeded)

  return [
    {
      name: 'get_pixelcraft_guide',
      description:
        'Read the PixelCraft language guide before writing any program. PixelCraft is the ' +
        'pixel-art DSL this app compiles: a program declares a canvas and a palette, then ' +
        'draws with commands like rect, circ, line, poly, and animates with frames or timeline. ' +
        'The guide is generated from the compiler\'s own docs, so it never drifts from what ' +
        'actually compiles. Call this first in any session.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, idempotentHint: true },
      execute: () => {
        note('get_pixelcraft_guide', 'read the language guide')
        return ok({ guide: aiSystemPrompt() })
      }
    },

    {
      name: 'check_program',
      description:
        'Compile a PixelCraft program WITHOUT putting it on the canvas, and report exactly ' +
        'what is wrong or right with it: error codes with line numbers, the palette it ' +
        'declares, the colors it actually paints (which can differ if it used a raw hex ' +
        'literal), how much of the canvas it covers, and any warnings. This is the cheap ' +
        'iteration loop — check a draft here as many times as you need, then call ' +
        'set_program once it is right.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'The PixelCraft program to compile.' }
        },
        required: ['source']
      },
      annotations: { readOnlyHint: true },
      execute: (input: never) => {
        const { source } = input as { source: string }
        if (typeof source !== 'string' || source.length === 0) return fail('Provide a `source` string.')
        if (source.length > MAX_SOURCE_LENGTH) return fail(`Program exceeds ${MAX_SOURCE_LENGTH} characters.`)

        const result = inspect(source)
        note(
          'check_program',
          result.compiles
            ? `checked a draft — compiles, ${result.canvas.width}x${result.canvas.height}`
            : `checked a draft — ${result.errors.length} error(s)`,
          result.compiles
        )
        return result.compiles
          ? ok(result)
          : fail('The program does not compile. Fix the errors and check again.', result)
      }
    },

    {
      name: 'set_program',
      description:
        'Put a PixelCraft program on the canvas, replacing what is there. The person ' +
        'watching the page sees the result immediately. Rejected if it does not compile, ' +
        'so the canvas never holds a broken program — check_program first if unsure.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'The complete PixelCraft program.' }
        },
        required: ['source']
      },
      execute: (input: never) => {
        const { source } = input as { source: string }
        if (typeof source !== 'string' || source.length === 0) return fail('Provide a `source` string.')
        if (source.length > MAX_SOURCE_LENGTH) return fail(`Program exceeds ${MAX_SOURCE_LENGTH} characters.`)

        const result = inspect(source)
        if (!result.compiles) {
          note('set_program', `rejected — ${result.errors.length} error(s)`, false)
          return fail('Not applied: the program does not compile.', result)
        }

        api.setSource(source)
        api.setFrame(0)
        if (result.animation) api.setPlaying(true)
        note('set_program', `drew ${result.canvas.width}x${result.canvas.height}${result.animation ? `, ${result.animation.frames} frames` : ''}`)
        return ok({ ...result, applied: true, message: 'On the canvas. The person can see it now.' })
      }
    },

    {
      name: 'get_program',
      description:
        'Read the program currently on the canvas, along with what it compiles to. Use this ' +
        'to pick up where things stand before editing — the person may have changed the ' +
        'source by hand since you last wrote it.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => {
        const source = api.getSource()
        note('get_program', 'read the current program')
        return ok({ source, frame: api.getFrame(), ...inspect(source) })
      }
    },

    {
      name: 'describe_canvas',
      description:
        'Get a coarse TEXT MAP of what is currently drawn — a small character grid where ' +
        'each character is the dominant color of a region and "." is transparent, plus a ' +
        'legend, the painted bounding box, and coverage. Tool results cannot contain images, ' +
        'so this is how you check that a shape landed where you meant, that the subject is ' +
        'centred, or that you did not accidentally fill the background. It shows layout and ' +
        'silhouette, not detail — for anything about how the art LOOKS, ask the person.',
      inputSchema: {
        type: 'object',
        properties: {
          frame: { type: 'integer', minimum: 0, description: 'Frame to describe. Defaults to the visible one.' },
          detail: {
            type: 'integer',
            minimum: 8,
            maximum: 48,
            description: 'Grid size on the long edge. Default 24. Higher costs more tokens.'
          }
        }
      },
      annotations: { readOnlyHint: true },
      execute: (input: never) => {
        const { frame, detail } = (input ?? {}) as { frame?: number; detail?: number }
        try {
          const described = describeRender(api.getSource(), frame ?? api.getFrame(), detail ?? 24)
          note('describe_canvas', `read the canvas as a ${described.map[0]?.length ?? 0}-wide text map`)
          return ok(described)
        } catch (error) {
          note('describe_canvas', 'failed — the canvas program does not compile', false)
          return fail(error instanceof Error ? error.message : String(error))
        }
      }
    },

    {
      name: 'set_frame',
      description:
        'Show a specific frame of an animated program, and stop playback so it stays there. ' +
        'Useful for pointing the person at one moment of a loop.',
      inputSchema: {
        type: 'object',
        properties: { frame: { type: 'integer', minimum: 0 } },
        required: ['frame']
      },
      execute: (input: never) => {
        const { frame } = input as { frame: number }
        const render = renderToRgba(api.getSource())
        if (!render.ok) return fail('The canvas program does not compile.')
        if (!render.hasAnimation) return fail('This program is a still image — it has no frames.')

        const clamped = Math.max(0, Math.min(Math.floor(frame), render.frameCount - 1))
        api.setPlaying(false)
        api.setFrame(clamped)
        note('set_frame', `paused on frame ${clamped} of ${render.frameCount}`)
        return ok({ frame: clamped, frameCount: render.frameCount })
      }
    },

    {
      name: 'list_examples',
      description:
        'List the example PixelCraft programs bundled with this app — finished pieces ' +
        'covering tilesets, particle effects, character animation, HUD widgets and full ' +
        'scenes. Load one with load_example to study how something is done, or as a ' +
        'starting point to remix.',
      inputSchema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Optional filter on name or tags.' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      execute: (input: never) => {
        const { search } = (input ?? {}) as { search?: string }
        const needle = (search ?? '').trim().toLowerCase()
        const matches = GALLERY.filter(
          (item) =>
            needle === '' ||
            item.slug.includes(needle) ||
            item.title.toLowerCase().includes(needle) ||
            item.tags.some((tag) => tag.includes(needle))
        )
        note('list_examples', `listed ${matches.length} example(s)${needle ? ` matching "${search}"` : ''}`)
        return ok({
          count: matches.length,
          examples: matches.map(({ slug, title, width, height, frameCount, tags }) => ({
            slug,
            title,
            size: `${width}x${height}`,
            frames: frameCount || null,
            tags
          }))
        })
      }
    },

    {
      name: 'load_example',
      description:
        'Put one of the bundled examples on the canvas and return its source, so you can ' +
        'read how it works or edit it into something new.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'Slug from list_examples.' } },
        required: ['slug']
      },
      execute: async (input: never) => {
        const { slug } = input as { slug: string }
        const entry = findEntry(slug)
        if (!entry) return fail(`No example named "${slug}". Call list_examples to see what exists.`)

        const source = await loadExampleSource(slug)
        if (source === null) return fail(`Could not load the program for "${slug}".`)

        api.setSource(source)
        api.setFrame(0)
        api.setPlaying(entry.frameCount > 0)
        note('load_example', `loaded "${entry.title}"`)
        return ok({
          slug: entry.slug,
          title: entry.title,
          source,
          canvas: { width: entry.width, height: entry.height },
          frames: entry.frameCount || null
        })
      }
    },

    {
      name: 'export_artwork',
      description:
        'Save the current artwork to the person\'s device: "png" for a still image, "gif" ' +
        'for an animated loop, or "source" for the .pc program itself — the only format that ' +
        'round-trips back into the editor. The browser starts the download; you get back the ' +
        'filename.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['png', 'gif', 'source'] },
          scale: {
            type: 'integer',
            minimum: 1,
            maximum: 16,
            description: 'Integer upscale for png/gif. Default 8, since pixel art is small.'
          }
        },
        required: ['format']
      },
      execute: async (input: never) => {
        const { format, scale } = input as { format: 'png' | 'gif' | 'source'; scale?: number }
        try {
          const filename = await api.exportArtwork(format, Math.max(1, Math.min(16, scale ?? 8)))
          note('export_artwork', `exported ${filename}`)
          return ok({ filename, message: 'The download has started in the browser.' })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          note('export_artwork', `export failed — ${message}`, false)
          return fail(message)
        }
      }
    }
  ]
}
