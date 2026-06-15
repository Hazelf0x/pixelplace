import { NextRequest, NextResponse } from 'next/server'
import { aiDraw, hasServerKey } from '@/lib/ai'

export const runtime = 'nodejs'
// Refine loop can take several model round-trips; give it room.
export const maxDuration = 120

export async function POST(req: NextRequest) {
  let body: { prompt?: string; apiKey?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return NextResponse.json({ ok: false, error: 'prompt is required' }, { status: 400 })
  }
  if (!body.apiKey && !hasServerKey()) {
    return NextResponse.json(
      { ok: false, error: 'No API key configured. Set ANTHROPIC_API_KEY in apps/web/.env.local, or provide your own key.' },
      { status: 503 }
    )
  }

  try {
    const result = await aiDraw({ prompt, apiKey: body.apiKey })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI draw failed'
    // Surface auth errors distinctly so the UI can prompt for a key.
    const status = /api key/i.test(message) ? 401 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
