import { NextRequest, NextResponse } from 'next/server'
import { renderAnimation } from '@pixelplace/pixelcraft'

// Node runtime required: the GIF encoder runs on the same headless canvas as PNG.
export const runtime = 'nodejs'

// Live animation preview. Separate from /api/render so keystroke-debounced still
// previews stay cheap — encoding every frame is only worth it once a program
// actually declares frames.
export async function POST(req: NextRequest) {
  let body: { source?: string; scale?: number; fps?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const source = typeof body.source === 'string' ? body.source : ''
  const scale = Math.min(32, Math.max(1, Math.floor(body.scale ?? 12)))
  const fps = Math.min(50, Math.max(1, Math.floor(body.fps ?? 12)))

  const r = renderAnimation(source, { scale, fps })

  return NextResponse.json({
    ok: r.ok,
    errors: r.errors,
    warnings: r.warnings,
    width: r.width,
    height: r.height,
    hasAnimation: r.hasAnimation,
    frameCount: r.frameCount,
    fps: r.fps,
    palette: r.palette,
    gif: r.gif ? `data:image/gif;base64,${Buffer.from(r.gif).toString('base64')}` : null
  })
}
