import PixelEditor from '@/components/PixelEditor'
import { getPostSource } from '@/lib/storage'

const DEFAULT_SOURCE = `version 0.1
canvas 16x16
pal bg=#1a1c2c skin=#ef7d57 eye=#000000 white=#f4f4f4 blush=#ffcd75

fill 0,0 bg
rect 4,2 8x10 skin

mirror :x
rect 5,4 2x2 white
px 6,5 eye
px 4,8 blush

mirror off
line 6,9 9,9 eye
`

export default async function DrawPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  const initialSource = (from && (await getPostSource(from))) || DEFAULT_SOURCE

  return (
    <main className="container">
      <div className="page-head">
        <h1>Draw</h1>
        <p>Write PixelCraft on the left — it renders live. Save to post it.</p>
      </div>
      <PixelEditor initialSource={initialSource} />
    </main>
  )
}
