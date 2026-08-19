import { NextRequest, NextResponse } from 'next/server'
import { renderReplay } from '@pixelplace/pixelcraft'

// Node runtime required: replay encodes a PNG per step.
export const runtime = 'nodejs'

// Replay is fetched on demand rather than rendered with the page — a long program
// can produce a few hundred KB of step images, and most visitors never ask for it.
export async function POST(req: NextRequest) {
  let body: { source?: string; scale?: number; frame?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const source = typeof body.source === 'string' ? body.source : ''
  const scale = Math.min(16, Math.max(1, Math.floor(body.scale ?? 8)))
  const frame = Math.max(0, Math.floor(body.frame ?? 0))

  const r = renderReplay(source, { scale, frame })

  return NextResponse.json({
    ok: r.ok,
    errors: r.errors,
    width: r.width,
    height: r.height,
    palette: r.palette,
    steps: r.steps,
    truncated: r.truncated
  })
}
