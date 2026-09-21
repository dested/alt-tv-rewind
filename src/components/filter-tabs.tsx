import { EPISODE_FILTERS, type EpisodeFilter } from '~/lib/taxonomy'
import { cn } from '~/lib/utils'

export function FilterTabs({
  value,
  counts,
  onChange,
}: {
  value: EpisodeFilter
  counts?: Partial<Record<EpisodeFilter, number>>
  onChange: (f: EpisodeFilter) => void
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5">
      {EPISODE_FILTERS.map((f) => {
        const active = f.key === value
        const count = counts?.[f.key]
        return (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.key)}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}>
            {`${f.glyph} ${f.label}`.trim()}
            {count !== undefined && <span className="ml-1 tabular-nums opacity-70">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
