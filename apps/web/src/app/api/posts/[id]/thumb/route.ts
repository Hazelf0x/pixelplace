import { NextRequest, NextResponse } from 'next/server'
import { getPostThumb } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const png = await getPostThumb(id)
  if (!png) {
    return new NextResponse('not found', { status: 404 })
  }
  return new NextResponse(png as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  })
}
