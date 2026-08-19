import { NextRequest, NextResponse } from 'next/server'
import { renderSource, renderSpriteSheet } from '@pixelplace/pixelcraft'
import { getPostAnimation, getPostMeta, getPostSource } from '@/lib/storage'

export const runtime = 'nodejs'

type Format = 'png' | 'gif' | 'sheet' | 'pc'

const FORMATS: Record<Format, { ext: string; type: string }> = {
  png: { ext: 'png', type: 'image/png' },
  gif: { ext: 'gif', type: 'image/gif' },
  sheet: { ext: 'png', type: 'image/png' },
  pc: { ext: 'pc', type: 'text/plain; charset=utf-8' }
}

/** Filenames land in someone's asset folder, so keep them boring and safe. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'pixelplace'
}

/**
 * Download a work in whatever form the receiving tool wants: a still PNG at a
 * chosen scale, the animated GIF, a tiled sprite sheet for a game engine, or the
 * PixelCraft source itself — which is the only one of the four that round-trips.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(req.url)

  const format = (url.searchParams.get('format') ?? 'png') as Format
  if (!(format in FORMATS)) {
    return NextResponse.json({ ok: false, error: `unknown format "${format}"` }, { status: 400 })
  }

  const scale = Math.min(32, Math.max(1, Math.floor(Number(url.searchParams.get('scale')) || 1)))
  const columnsParam = Number(url.searchParams.get('columns'))
  const columns = Number.isFinite(columnsParam) && columnsParam > 0 ? Math.floor(columnsParam) : undefined

  const [meta, source] = await Promise.all([getPostMeta(id), getPostSource(id)])
  if (!meta || !source) {
    return new NextResponse('not found', { status: 404 })
  }

  const name = `${slugify(meta.title)}${format === 'sheet' ? `-sheet-${scale}x` : format === 'png' ? `-${scale}x` : ''}.${FORMATS[format].ext}`
  const headers = {
    'Content-Type': FORMATS[format].type,
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'public, max-age=31536000, immutable'
  }

  if (format === 'pc') {
    return new NextResponse(source, { headers })
  }

  if (format === 'gif') {
    const gif = await getPostAnimation(id)
    if (!gif) {
      return NextResponse.json({ ok: false, error: 'this work is not animated' }, { status: 404 })
    }
    return new NextResponse(gif as unknown as BodyInit, { headers })
  }

  if (format === 'sheet') {
    const sheet = renderSpriteSheet(source, { scale, columns })
    if (!sheet.ok || !sheet.png) {
      return NextResponse.json({ ok: false, error: 'render failed', errors: sheet.errors }, { status: 422 })
    }
    return new NextResponse(sheet.png as unknown as BodyInit, {
      headers: {
        ...headers,
        // Slicing metadata, so an importer doesn't have to guess the grid.
        'X-Sprite-Frame-Width': String(sheet.frameWidth),
        'X-Sprite-Frame-Height': String(sheet.frameHeight),
        'X-Sprite-Columns': String(sheet.columns),
        'X-Sprite-Rows': String(sheet.rows)
      }
    })
  }

  const rendered = renderSource(source, { scale, frame: 0 })
  if (!rendered.ok || !rendered.png) {
    return NextResponse.json({ ok: false, error: 'render failed', errors: rendered.errors }, { status: 422 })
  }
  return new NextResponse(rendered.png as unknown as BodyInit, { headers })
}
