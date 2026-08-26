// The bundled example gallery.
//
// Metadata is compiled in (small); the programs themselves are static files fetched
// on demand, so 58 examples add almost nothing to the JS bundle. Everything here
// works without a server: no database, no API, no session.
import { GALLERY_DATA, type GalleryEntry } from './gallery-data'

export type { GalleryEntry }

export const GALLERY = GALLERY_DATA

export function findEntry(slug: string): GalleryEntry | undefined {
  return GALLERY.find((entry) => entry.slug === slug)
}

/** Preview image paths. Animated pieces have both; stills only have the PNG. */
export function previewPng(entry: GalleryEntry): string {
  return `/gallery/${entry.slug}.png`
}

export function previewGif(entry: GalleryEntry): string | null {
  return entry.hasGif ? `/gallery/${entry.slug}.gif` : null
}

export function sourceUrl(slug: string): string {
  return `/gallery/${slug}.pc`
}

const cache = new Map<string, string>()

/** Fetch an example's program, memoised — the files are immutable per deploy. */
export async function loadExampleSource(slug: string): Promise<string | null> {
  if (!findEntry(slug)) return null
  const cached = cache.get(slug)
  if (cached !== undefined) return cached

  const response = await fetch(sourceUrl(slug))
  if (!response.ok) return null
  const source = await response.text()
  cache.set(slug, source)
  return source
}

/** Every distinct tag across the corpus, most common first — used for filter chips. */
export function allTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const entry of GALLERY) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
