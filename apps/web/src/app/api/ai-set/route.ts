import { NextRequest, NextResponse } from 'next/server'
import { MAX_SET_SIZE, MIN_SET_SIZE, aiDrawSet } from '@/lib/ai-sets'
import { hasServerKey } from '@/lib/ai'

export const runtime = 'nodejs'
// Planning plus a fan-out of members, each with its own refine loop.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  let body: { prompt?: string; count?: number; apiKey?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return NextResponse.json({ ok: false, error: 'prompt is required' }, { status: 400 })
  }

  const count = Math.max(MIN_SET_SIZE, Math.min(MAX_SET_SIZE, Math.floor(body.count ?? 4)))

  if (!body.apiKey && !hasServerKey()) {
    return NextResponse.json(
      { ok: false, error: 'No API key configured. Set ANTHROPIC_API_KEY in apps/web/.env.local, or provide your own key.' },
      { status: 503 }
    )
  }

  try {
    return NextResponse.json(await aiDrawSet({ prompt, count, apiKey: body.apiKey }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Set generation failed'
    const status = /api key/i.test(message) ? 401 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
