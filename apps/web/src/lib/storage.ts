// Disk-based post storage for Milestone 1 (Postgres comes in Milestone 2).
// A post is a PixelCraft program; we persist the source (the canonical document),
// a rendered thumbnail PNG, and metadata. Layout: <dataDir>/posts/<id>/{post.pc,thumb.png,meta.json}
import 'server-only'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { renderSource } from '@pixelplace/pixelcraft'

const DATA_DIR = path.join(process.cwd(), '.data')
const POSTS_DIR = path.join(DATA_DIR, 'posts')

export interface PostMeta {
  id: string
  title: string
  author: string
  authorType: 'human' | 'ai'
  createdAt: string
  width: number
  height: number
  hasAnimation: boolean
  frameCount: number
  palette: string[]
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(POSTS_DIR, { recursive: true })
}

export interface SavePostInput {
  source: string
  title?: string
  author?: string
  authorType?: 'human' | 'ai'
}

export async function savePost(input: SavePostInput): Promise<{ ok: true; meta: PostMeta } | { ok: false; errors: { code: string; message: string; line: number; column: number }[] }> {
  // The thumbnail is rendered at a fixed upscale so the feed shows crisp pixels.
  const rendered = renderSource(input.source, { scale: 12, frame: 0 })
  if (!rendered.ok || !rendered.png) {
    return { ok: false, errors: rendered.errors }
  }

  await ensureDirs()
  const id = crypto.randomUUID()
  const dir = path.join(POSTS_DIR, id)
  await fs.mkdir(dir, { recursive: true })

  const meta: PostMeta = {
    id,
    title: (input.title ?? 'untitled').slice(0, 120),
    author: input.author ?? 'anon',
    authorType: input.authorType ?? 'human',
    createdAt: new Date().toISOString(),
    width: rendered.width,
    height: rendered.height,
    hasAnimation: rendered.hasAnimation,
    frameCount: rendered.frameCount,
    palette: rendered.palette
  }

  await fs.writeFile(path.join(dir, 'post.pc'), input.source, 'utf8')
  await fs.writeFile(path.join(dir, 'thumb.png'), rendered.png)
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')

  return { ok: true, meta }
}

export async function listPosts(): Promise<PostMeta[]> {
  try {
    const ids = await fs.readdir(POSTS_DIR)
    const metas = await Promise.all(
      ids.map(async (id) => {
        try {
          const raw = await fs.readFile(path.join(POSTS_DIR, id, 'meta.json'), 'utf8')
          return JSON.parse(raw) as PostMeta
        } catch {
          return null
        }
      })
    )
    return metas
      .filter((m): m is PostMeta => m !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

export async function getPostSource(id: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(POSTS_DIR, id, 'post.pc'), 'utf8')
  } catch {
    return null
  }
}

export async function getPostThumb(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(POSTS_DIR, id, 'thumb.png'))
  } catch {
    return null
  }
}
