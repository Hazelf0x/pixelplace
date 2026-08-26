import Studio from '@/components/Studio'

export const metadata = {
  title: 'Studio — PixelPlace',
  description:
    'Write PixelCraft by hand or hand the tools to your agent. The compiler runs in your browser.'
}

export default async function StudioPage({
  searchParams
}: {
  searchParams: Promise<{ example?: string }>
}) {
  const { example } = await searchParams

  // The program is the document, so an example is just a source string. Loading it
  // server-side keeps the first paint correct instead of flashing the starter art.
  let initialSource: string | undefined
  if (example && /^[a-z0-9_-]+$/i.test(example)) {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    try {
      initialSource = await readFile(join(process.cwd(), 'public', 'gallery', `${example}.pc`), 'utf8')
    } catch {
      // An unknown slug just opens the studio on the starter program.
    }
  }

  return <Studio initialSource={initialSource} />
}
