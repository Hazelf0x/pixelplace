import { NextRequest, NextResponse } from 'next/server'
import { renderSetSheet } from '@pixelplace/pixelcraft'
import { getPostSource, getSetMeta } from '@/lib/storage'

export const runtime = 'nodejs'

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return slug || 'set'
}

/**
 * The whole set as one tiled PNG — the form a game engine actually imports.
 * Because every member was held to the same palette and canvas, the grid is
 * uniform and the colors are consistent by construction rather than by luck.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(req.url)
  const scale = Math.min(32, Math.max(1, Math.floor(Number(url.searchParams.get('scale')) || 1)))
  const columnsParam = Number(url.searchParams.get('columns'))
  const columns = Number.isFinite(columnsParam) && columnsParam > 0 ? Math.floor(columnsParam) : undefined

  const meta = await getSetMeta(id)
  if (!meta) {
    return new NextResponse('not found', { status: 404 })
  }

  const sources = await Promise.all(meta.members.map((m) => getPostSource(m.id)))
  const present = sources.filter((s): s is string => typeof s === 'string')
  if (present.length !== meta.members.length) {
    return NextResponse.json({ ok: false, error: 'a member of this set is missing' }, { status: 404 })
  }

  const sheet = renderSetSheet(present, { scale, columns })
  if (!sheet.ok || !sheet.png) {
    return NextResponse.json({ ok: false, error: 'render failed', errors: sheet.errors }, { status: 422 })
  }

  return new NextResponse(sheet.png as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${slugify(meta.title)}-set-${scale}x.png"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Sprite-Frame-Width': String(sheet.frameWidth),
      'X-Sprite-Frame-Height': String(sheet.frameHeight),
      'X-Sprite-Columns': String(sheet.columns),
      'X-Sprite-Rows': String(sheet.rows)
    }
  })
}
