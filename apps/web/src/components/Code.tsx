import { highlight, type Span } from '@/lib/highlight'

function renderSpan(span: Span, key: number) {
  // A colour literal is drawn in the colour it names, which is the one case where
  // the highlighting carries information the text alone does not.
  if (span.kind === 'color') {
    return (
      <span key={key} className="tok-color" style={{ color: span.swatch }}>
        {span.text}
      </span>
    )
  }
  if (span.kind === 'plain') return <span key={key}>{span.text}</span>
  return (
    <span key={key} className={`tok-${span.kind}`}>
      {span.text}
    </span>
  )
}

/**
 * A read-only PixelCraft listing, highlighted by the compiler's own lexer.
 *
 * Runs on the server: `highlight` touches nothing but the lexer, so the markup is
 * in the HTML and there is no flash of unstyled code.
 */
export default function Code({ source, className }: { source: string; className?: string }) {
  const lines = highlight(source.replace(/\s+$/, ''))

  return (
    <pre className={className}>
      <code>
        {lines.map((spans, index) => (
          <span key={index} className="code-line">
            {spans.map(renderSpan)}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}
