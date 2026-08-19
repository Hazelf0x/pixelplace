// The AI authoring loop: Claude draws by emitting PixelCraft, the server compiles
// + renders, and — crucially — feeds the compiler's stable diagnostic codes back
// so the model can fix its own mistakes. This draw→compile→refine cycle is what
// makes AI-authored pixel art reliable instead of one-shot guesswork.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { aiSystemPrompt, renderSource, validateSource, type Diagnostic } from '@pixelplace/pixelcraft'

// Default to the most capable model; override via env (e.g. claude-sonnet-5 for
// lower cost/latency on high volume). Not silently downgraded — it's your lever.
export const MODEL = process.env.PIXELPLACE_AI_MODEL ?? 'claude-opus-5'
const MAX_REFINE_ATTEMPTS = 3

// Extra instructions layered on PixelCraft's own authoring prompt.
const TASK_GUIDANCE = `
You are drawing a single piece for PixelPlace, where every work is a PixelCraft program.
- Return ONLY PixelCraft source code. No prose, no explanation.
- You may wrap it in a \`\`\`pixelcraft fenced block; nothing else.
- If the request doesn't imply a size, use a 32x32 canvas.
- Keep it self-contained: a single program with no \`include\`.
- Animation is welcome and encouraged when the subject suggests motion (a flame,
  a blinking eye, something walking). Use \`timeline 0..N { each { ... } }\` and
  drive movement with \`$frame\` — the site plays every frame back as a loop.
  Repaint the full canvas at the start of each frame so nothing smears.
Syntax reminders (common mistakes):
- arc takes ONE radius: \`arc X,Y R START END COLOR\` (e.g. \`arc 8,8 4 0 180 fur\`). Never two radii.
- ellipse uses a radius pair: \`ellipse X,Y RXxRY COLOR\` (e.g. \`ellipse 8,8 6x3 fur\`).
- circ: \`circ X,Y R COLOR\`. rect: \`rect X,Y WxH COLOR\`. line: \`line X1,Y1 X2,Y2 COLOR\`.`

export interface AiDrawResult {
  ok: boolean
  /** The final PixelCraft source (valid when ok). */
  source: string
  /** How many model calls it took (1 = clean first try). */
  attempts: number
  /** Remaining diagnostics if it never compiled cleanly. */
  errors: Diagnostic[]
  /** Rendered PNG as a data URL, present when ok. */
  png: string | null
  width: number
  height: number
  palette: string[]
  model: string
}

/** Pull the PixelCraft program out of the model's reply (handles ``` fences). */
export function extractSource(text: string): string {
  const fenced = text.match(/```(?:pixelcraft|pc|text)?\s*\n([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

function formatDiagnostics(errors: Diagnostic[]): string {
  return errors
    .map((e) => `- ${e.code} at line ${e.line}, col ${e.column}: ${e.message}`)
    .join('\n')
}

export function hasServerKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export function createClient(apiKey?: string): Anthropic {
  const key = apiKey || process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new Error('No Anthropic API key. Set ANTHROPIC_API_KEY in apps/web/.env.local, or supply your own key.')
  }
  return new Anthropic({ apiKey: key })
}

export interface DrawLoopResult {
  ok: boolean
  source: string
  attempts: number
  errors: Diagnostic[]
  png: string | null
  width: number
  height: number
  palette: string[]
}

export interface DrawLoopOptions {
  client: Anthropic
  system: string
  /** The opening user turn. */
  prompt: string
  /** Upscale for the returned preview PNG. */
  scale?: number
  /**
   * An extra gate applied *after* the program compiles and renders. Return a
   * complaint to send back to the model, or null to accept. This is how a caller
   * enforces something the compiler cannot know about — a locked palette, say —
   * while reusing the same refine loop.
   */
  verify?: (source: string) => string | null
}

/**
 * Run one draw→compile→refine conversation to completion.
 *
 * Shared by single drawings and by every member of a set, so both get the same
 * self-correction behaviour: the model sees its own diagnostics and tries again.
 */
export async function runDrawLoop({
  client,
  system,
  prompt,
  scale = 12,
  verify
}: DrawLoopOptions): Promise<DrawLoopResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]

  let lastSource = ''
  let lastErrors: Diagnostic[] = []

  for (let attempt = 1; attempt <= MAX_REFINE_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Latency lever. Thinking is on by default and disabling it on Opus 5 has
      // real failure modes, so we turn effort down instead: writing a short DSL
      // program is generative, not a reasoning problem, and this loop is what
      // actually enforces correctness.
      output_config: { effort: 'medium' },
      system,
      messages
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    const source = extractSource(text)
    lastSource = source

    // Structural correctness first: does it compile, and does it run?
    const validation = validateSource(source)
    let complaint: string | null = null

    if (!validation.ok) {
      lastErrors = validation.errors
      complaint = `Your PixelCraft had these errors:\n${formatDiagnostics(lastErrors)}`
    } else {
      const rendered = renderSource(source, { scale })
      if (!rendered.ok || !rendered.png) {
        lastErrors = rendered.errors
        complaint = `Your PixelCraft had these errors:\n${formatDiagnostics(lastErrors)}`
      } else {
        // Then the caller's own rule, which the compiler knows nothing about.
        const objection = verify?.(source) ?? null
        if (!objection) {
          return {
            ok: true,
            source,
            attempts: attempt,
            errors: [],
            png: `data:image/png;base64,${Buffer.from(rendered.png).toString('base64')}`,
            width: rendered.width,
            height: rendered.height,
            palette: rendered.palette
          }
        }
        lastErrors = []
        complaint = objection
      }
    }

    if (attempt < MAX_REFINE_ATTEMPTS) {
      messages.push({ role: 'assistant', content: text })
      messages.push({
        role: 'user',
        content: `${complaint}\n\nReturn the corrected, complete PixelCraft program (code only).`
      })
    }
  }

  return {
    ok: false,
    source: lastSource,
    attempts: MAX_REFINE_ATTEMPTS,
    errors: lastErrors,
    png: null,
    width: 0,
    height: 0,
    palette: []
  }
}

export interface AiDrawOptions {
  prompt: string
  /** BYOK seam: a user-supplied key overrides the server key for this call. */
  apiKey?: string
}

export async function aiDraw({ prompt, apiKey }: AiDrawOptions): Promise<AiDrawResult> {
  const client = createClient(apiKey)
  const result = await runDrawLoop({
    client,
    system: `${aiSystemPrompt()}\n${TASK_GUIDANCE}`,
    prompt: `Draw: ${prompt}`
  })
  return { ...result, model: MODEL }
}
