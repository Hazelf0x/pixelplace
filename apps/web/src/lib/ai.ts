// The AI authoring loop: Claude draws by emitting PixelCraft, the server compiles
// + renders, and — crucially — feeds the compiler's stable diagnostic codes back
// so the model can fix its own mistakes. This draw→compile→refine cycle is what
// makes AI-authored pixel art reliable instead of one-shot guesswork.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { aiSystemPrompt, renderSource, validateSource, type Diagnostic } from '@pixelplace/pixelcraft'

// Default to the most capable model; override via env (e.g. claude-sonnet-4-6 for
// lower cost/latency on high volume). Not silently downgraded — it's your lever.
const MODEL = process.env.PIXELPLACE_AI_MODEL ?? 'claude-opus-4-8'
const MAX_REFINE_ATTEMPTS = 3

// Extra instructions layered on PixelCraft's own authoring prompt.
const TASK_GUIDANCE = `
You are drawing a single post for PixelPlace, a pixel-art imageboard.
- Return ONLY PixelCraft source code. No prose, no explanation.
- You may wrap it in a \`\`\`pixelcraft fenced block; nothing else.
- If the request doesn't imply a size, use a 32x32 canvas.
- Keep it self-contained: a single program with no \`include\`.
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
function extractSource(text: string): string {
  const fenced = text.match(/```(?:pixelcraft|pc|text)?\s*\n([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

function formatDiagnostics(errors: Diagnostic[]): string {
  return errors
    .map((e) => `- ${e.code} at line ${e.line}, col ${e.column}: ${e.message}`)
    .join('\n')
}

export interface AiDrawOptions {
  prompt: string
  /** BYOK seam: a user-supplied key overrides the server key for this call. */
  apiKey?: string
}

export function hasServerKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function aiDraw({ prompt, apiKey }: AiDrawOptions): Promise<AiDrawResult> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new Error('No Anthropic API key. Set ANTHROPIC_API_KEY in apps/web/.env.local, or supply your own key.')
  }

  const client = new Anthropic({ apiKey: key })
  const system = `${aiSystemPrompt()}\n${TASK_GUIDANCE}`

  // Maintain a conversation so the model sees its prior attempt + the errors.
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Draw: ${prompt}` }
  ]

  let lastSource = ''
  let lastErrors: Diagnostic[] = []

  for (let attempt = 1; attempt <= MAX_REFINE_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      // No adaptive thinking: this is a generative DSL task, not a reasoning one.
      // Thinking made calls ~10x slower (200s+) for no quality gain; the
      // compile→refine loop handles correctness instead.
      model: MODEL,
      max_tokens: 4096,
      system,
      messages
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    const source = extractSource(text)
    lastSource = source

    const validation = validateSource(source)
    if (validation.ok) {
      // Compiles — render it (this also catches runtime-only errors like R010).
      const rendered = renderSource(source, { scale: 12 })
      if (rendered.ok && rendered.png) {
        return {
          ok: true,
          source,
          attempts: attempt,
          errors: [],
          png: `data:image/png;base64,${Buffer.from(rendered.png).toString('base64')}`,
          width: rendered.width,
          height: rendered.height,
          palette: rendered.palette,
          model: MODEL
        }
      }
      lastErrors = rendered.errors
    } else {
      lastErrors = validation.errors
    }

    // Not the last attempt → ask the model to fix its own diagnostics.
    if (attempt < MAX_REFINE_ATTEMPTS) {
      messages.push({ role: 'assistant', content: text })
      messages.push({
        role: 'user',
        content:
          `Your PixelCraft had these errors:\n${formatDiagnostics(lastErrors)}\n\n` +
          `Return the corrected, complete PixelCraft program (code only).`
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
    palette: [],
    model: MODEL
  }
}
