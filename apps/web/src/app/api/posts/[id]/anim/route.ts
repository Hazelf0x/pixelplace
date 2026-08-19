import { NextRequest, NextResponse } from 'next/server'
import { getPostAnimation } from '@/lib/storage'

export const runtime = 'nodejs'

// Animated posts serve the GIF encoded at save time. Still posts have none —
// callers fall back to /thumb.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gif = await getPostAnimation(id)
  if (!gif) {
    return new NextResponse('not found', { status: 404 })
  }
  return new NextResponse(gif as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/gif',
      // A post's source is immutable, so its render is too.
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  })
}
