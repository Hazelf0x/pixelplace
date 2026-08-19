// Disk-based post storage for Milestone 1 (Postgres comes in Milestone 2).
// A post is a PixelCraft program; we persist the source (the canonical document),
// a rendered thumbnail PNG, an animated GIF when the program has frames, and
// metadata. Layout: <dataDir>/posts/<id>/{post.pc,thumb.png,anim.gif,meta.json}
import 'server-only'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { renderAnimation, renderSource } from '@pixelplace/pixelcraft'

const DATA_DIR = path.join(process.cwd(), '.data')
const POSTS_DIR = path.join(DATA_DIR, 'posts')
const SETS_DIR = path.join(DATA_DIR, 'sets')

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
  /** Playback rate the stored GIF was encoded at. Only meaningful when animated. */
  fps: number
  palette: string[]
}

// Post ids come from URL segments and query params, so they are untrusted input
// heading straight into path.join. Only the exact ids we mint are acceptable —
// anything else (notably "..") could escape the data directory.
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function postDir(id: string): string | null {
  return ID_PATTERN.test(id) ? path.join(POSTS_DIR, id) : null
}

/** Posts written before a field existed still have to load, so read metadata leniently. */
function parseMeta(raw: string): PostMeta {
  const parsed = JSON.parse(raw) as Partial<PostMeta>
  return { ...parsed, fps: parsed.fps ?? DEFAULT_FPS } as PostMeta
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(POSTS_DIR, { recursive: true })
  await fs.mkdir(SETS_DIR, { recursive: true })
}

function setDir(id: string): string | null {
  return ID_PATTERN.test(id) ? path.join(SETS_DIR, id) : null
}

export interface SetMemberMeta {
  id: string
  name: string
}

export interface SetMeta {
  id: string
  title: string
  author: string
  authorType: 'human' | 'ai'
  createdAt: string
  /** The palette every member was held to, in declaration order. */
  palette: string[]
  canvas: string
  members: SetMemberMeta[]
}

export interface SavePostInput {
  source: string
  title?: string
  author?: string
  authorType?: 'human' | 'ai'
}

/** Upscale applied to stored renders, so the feed shows crisp pixels. */
const RENDER_SCALE = 12
/** No `fps` in the DSL yet — frame durations carry timing, playback rate is ours to pick. */
export const DEFAULT_FPS = 12

export async function savePost(input: SavePostInput): Promise<{ ok: true; meta: PostMeta } | { ok: false; errors: { code: string; message: string; line: number; column: number }[] }> {
  // The thumbnail is the still representation of the post (frame 0 for animations).
  const rendered = renderSource(input.source, { scale: RENDER_SCALE, frame: 0 })
  if (!rendered.ok || !rendered.png) {
    return { ok: false, errors: rendered.errors }
  }

  // Animated programs also get a GIF of every frame — encoded once at save time
  // rather than per request, since the source is immutable once posted.
  let gif: Uint8Array | null = null
  if (rendered.hasAnimation) {
    const animated = renderAnimation(input.source, { scale: RENDER_SCALE, fps: DEFAULT_FPS })
    if (!animated.ok) {
      return { ok: false, errors: animated.errors }
    }
    gif = animated.gif ?? null
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
    fps: DEFAULT_FPS,
    palette: rendered.palette
  }

  await fs.writeFile(path.join(dir, 'post.pc'), input.source, 'utf8')
  await fs.writeFile(path.join(dir, 'thumb.png'), rendered.png)
  if (gif) {
    await fs.writeFile(path.join(dir, 'anim.gif'), gif)
  }
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
          return parseMeta(raw)
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
  const dir = postDir(id)
  if (!dir) return null
  try {
    return await fs.readFile(path.join(dir, 'post.pc'), 'utf8')
  } catch {
    return null
  }
}

export async function getPostMeta(id: string): Promise<PostMeta | null> {
  const dir = postDir(id)
  if (!dir) return null
  try {
    const raw = await fs.readFile(path.join(dir, 'meta.json'), 'utf8')
    return parseMeta(raw)
  } catch {
    return null
  }
}

export async function getPostThumb(id: string): Promise<Buffer | null> {
  const dir = postDir(id)
  if (!dir) return null
  try {
    return await fs.readFile(path.join(dir, 'thumb.png'))
  } catch {
    return null
  }
}

export async function getPostAnimation(id: string): Promise<Buffer | null> {
  const dir = postDir(id)
  if (!dir) return null
  try {
    return await fs.readFile(path.join(dir, 'anim.gif'))
  } catch {
    return null
  }
}

// ---- Sets ------------------------------------------------------------------
// A set is a family of works that share a palette. Members are ordinary posts —
// individually viewable, remixable, and exportable — plus a record tying them
// together, so a set adds grouping without making its members second-class.

export interface SaveSetInput {
  title: string
  canvas: string
  palette: string[]
  author?: string
  authorType?: 'human' | 'ai'
  members: { name: string; source: string }[]
}

export async function saveSet(
  input: SaveSetInput
): Promise<{ ok: true; meta: SetMeta } | { ok: false; errors: { code: string; message: string; line: number; column: number }[] }> {
  const saved: SetMemberMeta[] = []

  for (const member of input.members) {
    const result = await savePost({
      source: member.source,
      title: member.name,
      author: input.author,
      authorType: input.authorType
    })
    // A set is all-or-nothing: a half-written set is worse than a clear failure.
    if (!result.ok) {
      await Promise.all(saved.map((m) => deletePost(m.id)))
      return { ok: false, errors: result.errors }
    }
    saved.push({ id: result.meta.id, name: member.name })
  }

  await ensureDirs()
  const id = crypto.randomUUID()
  const dir = path.join(SETS_DIR, id)
  await fs.mkdir(dir, { recursive: true })

  const meta: SetMeta = {
    id,
    title: input.title.slice(0, 120),
    author: input.author ?? 'anon',
    authorType: input.authorType ?? 'human',
    createdAt: new Date().toISOString(),
    palette: input.palette,
    canvas: input.canvas,
    members: saved
  }

  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return { ok: true, meta }
}

export async function getSetMeta(id: string): Promise<SetMeta | null> {
  const dir = setDir(id)
  if (!dir) return null
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as SetMeta
  } catch {
    return null
  }
}

export async function listSets(): Promise<SetMeta[]> {
  try {
    const ids = await fs.readdir(SETS_DIR)
    const metas = await Promise.all(ids.map((id) => getSetMeta(id)))
    return metas
      .filter((m): m is SetMeta => m !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

/** Used to roll back a partially written set. */
async function deletePost(id: string): Promise<void> {
  const dir = postDir(id)
  if (!dir) return
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // best effort — the set save is already failing
  }
}
