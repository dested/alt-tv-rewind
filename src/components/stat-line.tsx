// The inline stat row used on the episode page — no cards, no icons.
export function StatLine({ items }: { items: Array<{ value: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-3">
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          <div className="font-serif text-xl font-semibold tabular-nums">{item.value}</div>
          <span className="text-muted-foreground block text-xs">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
