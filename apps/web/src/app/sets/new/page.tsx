import SetStudio from '@/components/SetStudio'

export default function NewSetPage() {
  return (
    <main className="container">
      <div className="page-head">
        <h1>New set</h1>
        <p>
          A family of pieces that share one palette and one canvas — icons, item variants, a
          character&apos;s facings. Consistency is enforced, not hoped for.
        </p>
      </div>
      <SetStudio />
    </main>
  )
}
