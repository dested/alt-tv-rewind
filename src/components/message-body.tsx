import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { type Block, parseMessage } from '~/lib/usenet'

function quoteLabel(attribution: string | null, lineCount: number): string {
  const lines = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`
  return attribution ? `Quoting ${attribution} · ${lines}` : `Quoted text · ${lines}`
}

function QuoteBlock({
  block,
  startOpen,
}: {
  block: Extract<Block, { type: 'quote' }>
  startOpen: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  const label = quoteLabel(block.attribution, block.lineCount)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-sans text-xs">
        <ChevronRight className="size-3" />
        {label}
      </button>
    )
  }

  return (
    <div className="post-quote space-y-2">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-sans text-xs">
        <ChevronDown className="size-3" />
        {label}
      </button>
      {renderBlocks(block.blocks)}
    </div>
  )
}

function renderBlocks(blocks: Block[]): React.ReactNode {
  return blocks.map((block, i) => {
    switch (block.type) {
      case 'paragraph':
        return <p key={i}>{block.text}</p>
      case 'list':
        return (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        )
      case 'pre':
        return (
          <pre key={i} className="post-pre">
            {block.text}
          </pre>
        )
      case 'quote':
        // Nested quotes are always chips; the top-level all-quotes exception is
        // handled in MessageBody where it knows whether any prose exists.
        return <QuoteBlock key={i} block={block} startOpen={false} />
      case 'signature':
        return (
          <footer
            key={i}
            className="text-muted-foreground/80 mt-3 font-sans text-xs whitespace-pre-line">
            {block.lines.join('\n')}
          </footer>
        )
    }
  })
}

export function MessageBody({ body }: { body: string }) {
  const blocks = useMemo(() => parseMessage(body), [body])
  const hasProse = blocks.some(
    (b) => b.type === 'paragraph' || b.type === 'list' || b.type === 'pre'
  )

  return (
    <div className="post max-w-[68ch] space-y-3">
      {blocks.map((block, i) =>
        block.type === 'quote' ? (
          <QuoteBlock key={i} block={block} startOpen={!hasProse} />
        ) : (
          <Fragment key={i}>{renderBlocks([block])}</Fragment>
        )
      )}
    </div>
  )
}
