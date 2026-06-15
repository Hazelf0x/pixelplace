import { NextRequest, NextResponse } from 'next/server'
import { renderSource } from '@pixelplace/pixelcraft'

// Node runtime required: the PNG encoder uses node:zlib.
export const runtime = 'nodejs'

// Live-preview endpoint. Same canonical pipeline that produces stored thumbnails,
// so what you see while drawing is exactly what gets saved.
export async function POST(req: NextRequest) {
  let body: { source?: string; scale?: number; frame?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const source = typeof body.source === 'string' ? body.source : ''
  const scale = Math.min(32, Math.max(1, Math.floor(body.scale ?? 12)))
  const frame = Math.max(0, Math.floor(body.frame ?? 0))

  const r = renderSource(source, { scale, frame })

  return NextResponse.json({
    ok: r.ok,
    errors: r.errors,
    warnings: r.warnings,
    width: r.width,
    height: r.height,
    hasAnimation: r.hasAnimation,
    frameCount: r.frameCount,
    palette: r.palette,
    png: r.png ? `data:image/png;base64,${Buffer.from(r.png).toString('base64')}` : null
  })
}
