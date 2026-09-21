// The inline stat row used on the episode page — no cards, no icons.
export function StatLine({ items }: { items: Array<{ value: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="tabular-nums">
          <strong className="font-medium">{item.value}</strong>{' '}
          <span className="text-muted-foreground text-xs">{item.label}</span>
        </span>
      ))}
    </div>
  )
}
