// Asset sets: one prompt to a family of pieces that share a palette and a canvas.
//
// This is the thing diffusion structurally cannot do. Consistency here is not a
// stylistic hope — the palette is planned once, pinned into every member's
// prompt, and then *verified against the pixels each member actually paints*.
// A member that strays is sent back with the exact offending colors.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { aiSystemPrompt, extractUsedColors, measureCoverage, type Diagnostic } from '@pixelplace/pixelcraft'
import { MODEL, createClient, runDrawLoop } from './ai'

export const MIN_SET_SIZE = 2
export const MAX_SET_SIZE = 12

/**
 * A member told to leave its background transparent cannot legitimately cover the
 * whole canvas. This is compliance with an instruction we gave, not a judgement of
 * taste — and it catches the common failure where a member renders as a solid
 * filled rectangle: valid PixelCraft, on-palette, and not a drawing of anything.
 */
const MAX_COVERAGE = 0.92

export interface SetPlanEntry {
  name: string
  brief: string
}

export interface SetPlan {
  title: string
  canvas: string
  palette: { name: string; hex: string }[]
  members: SetPlanEntry[]
}

export interface SetMemberResult {
  name: string
  brief: string
  ok: boolean
  source: string
  attempts: number
  errors: Diagnostic[]
  png: string | null
  /** Colors this member painted that were not in the shared palette. */
  offPalette: string[]
  /** Fraction of the canvas this member painted, 0..1. */
  coverage: number
}

export interface AiSetResult {
  ok: boolean
  plan: SetPlan
  members: SetMemberResult[]
  model: string
  /** Total model calls across planning and every member. */
  calls: number
}

/** Normalize any hex form to lowercase #rrggbbaa so colors compare reliably. */
function normalizeHex(hex: string): string | null {
  const raw = hex.trim().toLowerCase().replace(/^#/, '')
  const expand = (s: string) => s.split('').map((c) => c + c).join('')

  if (/^[0-9a-f]{3}$/.test(raw)) return `#${expand(raw)}ff`
  if (/^[0-9a-f]{4}$/.test(raw)) return `#${expand(raw)}`
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}ff`
  if (/^[0-9a-f]{8}$/.test(raw)) return `#${raw}`
  return null
}

const PLAN_SYSTEM = `You plan sets of pixel art assets. Reply with ONE JSON object and nothing else.

Shape:
{
  "title": "short name for the whole set",
  "canvas": "WxH",
  "palette": [{ "name": "identifier", "hex": "#rrggbb" }],
  "members": [{ "name": "short name", "brief": "one sentence describing this piece" }]
}

Rules:
- The palette is SHARED by every member. Choose 6-14 colors that cover the whole
  set: shadows, mid-tones, highlights, and any accent each member needs.
- Do NOT include a background color. Backgrounds stay transparent, so a member
  never fills the canvas — these are assets to be dropped onto something else.
- Palette names must be lowercase identifiers usable as PixelCraft palette keys
  (letters, digits, underscore; no spaces).
- Every member uses the SAME canvas size. Prefer 32x32 unless asked otherwise.
- Members must be visibly distinct from one another but obviously a family.
- Output raw JSON. No markdown fence, no commentary.`

function memberGuidance(plan: SetPlan, paletteLine: string): string {
  return `
You are drawing ONE member of a set of pixel art assets that must look like a family.
- Return ONLY PixelCraft source code. No prose. A \`\`\`pixelcraft fence is allowed.
- The canvas MUST be exactly: canvas ${plan.canvas}
- You MUST use this exact palette line, verbatim, and declare no other colors:
  ${paletteLine}
- Use ONLY those palette names. Do NOT write raw hex literals like #ff00ff anywhere
  in the program — every color must come from the palette above.
- Leave the background TRANSPARENT: never \`fill\` the canvas or draw a full-canvas
  rect. Unpainted pixels are transparent, which is what an asset needs so it can sit
  on any background. Draw only the subject itself.
- Keep it self-contained: one program, no \`include\`.
- Animation is allowed via \`timeline 0..N { each { ... } }\` with \`$frame\`, but the
  member must read clearly on its first frame, since that is its thumbnail in the set.
Syntax reminders (common mistakes):
- arc takes ONE radius: \`arc X,Y R START END COLOR\`. Never two radii.
- ellipse uses a radius pair: \`ellipse X,Y RXxRY COLOR\`.
- circ: \`circ X,Y R COLOR\`. rect: \`rect X,Y WxH COLOR\`. line: \`line X1,Y1 X2,Y2 COLOR\`.`
}

/** Best-effort JSON extraction — models sometimes fence JSON despite instructions. */
function parsePlan(text: string, fallbackCount: number): SetPlan {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('The planning step did not return JSON.')
  }

  const parsed = JSON.parse(body.slice(start, end + 1)) as Partial<SetPlan>

  const palette = (parsed.palette ?? [])
    .map((entry) => ({
      name: String(entry?.name ?? '').replace(/[^a-zA-Z0-9_]/g, ''),
      hex: normalizeHex(String(entry?.hex ?? '')) ? String(entry.hex).trim().toLowerCase() : ''
    }))
    .filter((entry) => entry.name.length > 0 && entry.hex.length > 0)

  const members = (parsed.members ?? [])
    .map((entry) => ({
      name: String(entry?.name ?? '').slice(0, 60),
      brief: String(entry?.brief ?? '').slice(0, 240)
    }))
    .filter((entry) => entry.name.length > 0)
    .slice(0, MAX_SET_SIZE)

  if (palette.length === 0) throw new Error('The planning step returned no usable palette.')
  if (members.length === 0) throw new Error('The planning step returned no members.')

  return {
    title: String(parsed.title ?? 'untitled set').slice(0, 120),
    canvas: /^\d{1,3}x\d{1,3}$/.test(String(parsed.canvas ?? '')) ? String(parsed.canvas) : '32x32',
    palette,
    members: members.slice(0, Math.max(MIN_SET_SIZE, Math.min(fallbackCount, members.length)))
  }
}

async function planSet(client: Anthropic, prompt: string, count: number): Promise<SetPlan> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: 'medium' },
    system: PLAN_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Plan a set of exactly ${count} pixel art assets: ${prompt}`
      }
    ]
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

  return parsePlan(text, count)
}

export interface AiSetOptions {
  prompt: string
  count: number
  apiKey?: string
}

export async function aiDrawSet({ prompt, count, apiKey }: AiSetOptions): Promise<AiSetResult> {
  const size = Math.max(MIN_SET_SIZE, Math.min(MAX_SET_SIZE, Math.floor(count)))
  const client = createClient(apiKey)

  const plan = await planSet(client, prompt, size)
  const paletteLine = `pal ${plan.palette.map((c) => `${c.name}=${c.hex}`).join(' ')}`

  // The set of colors a member is permitted to paint, in comparable form.
  const allowed = new Set(
    plan.palette.map((c) => normalizeHex(c.hex)).filter((h): h is string => h !== null)
  )

  const system = `${aiSystemPrompt()}\n${memberGuidance(plan, paletteLine)}`

  // Members are independent, so draw them concurrently — a set of eight costs
  // roughly the wall-clock of the slowest member, not the sum of all of them.
  const members = await Promise.all(
    plan.members.map(async (entry): Promise<SetMemberResult> => {
      let offPalette: string[] = []
      let coverage = 0

      const result = await runDrawLoop({
        client,
        system,
        prompt: `Draw this member of the "${plan.title}" set.\nName: ${entry.name}\n${entry.brief}`,
        verify: (source) => {
          // Judge the pixels, not the declaration: a member can declare the right
          // palette and still paint an inline hex literal.
          const strays = extractUsedColors(source).filter((c) => !allowed.has(c))
          offPalette = strays
          if (strays.length > 0) {
            return (
              `Your program painted ${strays.length} color(s) outside the set's shared palette: ` +
              `${strays.slice(0, 8).join(', ')}.\n` +
              `Every member must paint ONLY colors from this palette line:\n${paletteLine}\n` +
              `Replace the stray colors with the nearest palette entry by name, and remove any raw hex literals.`
            )
          }

          coverage = measureCoverage(source).ratio
          if (coverage > MAX_COVERAGE) {
            return (
              `Your program painted ${Math.round(coverage * 100)}% of the canvas, so it has no ` +
              `transparent background — it reads as a solid block rather than a drawing of ` +
              `"${entry.name}".\nDraw only the subject, centred, and leave the surrounding pixels ` +
              `unpainted. Do not fill the canvas or draw a rect covering all of it.`
            )
          }

          return null
        }
      })

      return {
        name: entry.name,
        brief: entry.brief,
        ok: result.ok,
        source: result.source,
        attempts: result.attempts,
        errors: result.errors,
        png: result.png,
        offPalette: result.ok ? [] : offPalette,
        coverage
      }
    })
  )

  return {
    ok: members.every((m) => m.ok),
    plan,
    members,
    model: MODEL,
    // One planning call, plus however many attempts each member consumed.
    calls: 1 + members.reduce((total, m) => total + m.attempts, 0)
  }
}
