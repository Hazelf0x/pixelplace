import { NextRequest, NextResponse } from 'next/server'
import { listSets, saveSet } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ sets: await listSets() })
}

export async function POST(req: NextRequest) {
  let body: {
    title?: string
    canvas?: string
    palette?: string[]
    author?: string
    authorType?: string
    members?: { name?: string; source?: string }[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const members = (body.members ?? [])
    .map((m) => ({ name: String(m?.name ?? 'untitled'), source: String(m?.source ?? '') }))
    .filter((m) => m.source.trim().length > 0)

  if (members.length === 0) {
    return NextResponse.json({ ok: false, error: 'a set needs at least one member' }, { status: 400 })
  }

  const result = await saveSet({
    title: body.title?.trim() || 'untitled set',
    canvas: body.canvas ?? '',
    palette: Array.isArray(body.palette) ? body.palette.map(String) : [],
    author: body.author,
    authorType: body.authorType === 'ai' ? 'ai' : 'human',
    members
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'render failed', errors: result.errors }, { status: 422 })
  }
  return NextResponse.json({ ok: true, meta: result.meta })
}
