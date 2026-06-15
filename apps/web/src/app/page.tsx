import Link from 'next/link'
import { listPosts } from '@/lib/storage'

// Feed is a server component: it reads posts straight from disk, no client fetch.
export const dynamic = 'force-dynamic'

export default async function FeedPage() {
  const posts = await listPosts()

  return (
    <main className="container">
      <div className="page-head">
        <h1>Feed</h1>
        <p>Every post is pixel art. No uploads — only the editor.</p>
      </div>

      {posts.length === 0 ? (
        <div className="empty">
          <p>Nothing here yet.</p>
          <Link href="/draw" className="btn primary">Draw the first post</Link>
        </div>
      ) : (
        <div className="feed-grid">
          {posts.map((p) => (
            <Link key={p.id} href={`/draw?from=${p.id}`} className="post-card">
              <div className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/posts/${p.id}/thumb`} alt={p.title} />
              </div>
              <div className="body">
                <div className="title">{p.title}</div>
                <div className="sub">
                  <span className={`tag ${p.authorType}`}>{p.authorType}</span>
                  <span>{p.width}×{p.height}</span>
                  {p.hasAnimation ? <span>· {p.frameCount}f</span> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
