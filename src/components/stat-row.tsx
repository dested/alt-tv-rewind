// Bare figures in a row — no cards, no icons (ui.md). Values are proportional
// at display size; callers pass already-formatted strings.
export function StatRow({ items }: { items: Array<{ value: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="font-serif text-3xl font-semibold tabular-nums">{item.value}</div>
          <span className="text-muted-foreground block text-xs">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
