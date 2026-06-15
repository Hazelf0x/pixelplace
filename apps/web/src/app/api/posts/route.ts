import { NextRequest, NextResponse } from 'next/server'
import { listPosts, savePost } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ posts: await listPosts() })
}

export async function POST(req: NextRequest) {
  let body: { source?: string; title?: string; author?: string; authorType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.source !== 'string' || body.source.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'source is required' }, { status: 400 })
  }

  // Only honor an explicit 'ai' tag; anything else is treated as human-authored.
  const authorType = body.authorType === 'ai' ? 'ai' : 'human'

  const result = await savePost({
    source: body.source,
    title: body.title,
    author: body.author,
    authorType
  })

  if (!result.ok) {
    // The drawing didn't compile/render — reject it (purity: only valid pixel art is stored).
    return NextResponse.json({ ok: false, error: 'render failed', errors: result.errors }, { status: 422 })
  }

  return NextResponse.json({ ok: true, meta: result.meta })
}
