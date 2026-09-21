import { cn } from '~/lib/utils'

// 1px line, no axes. Deterministic SVG (no window reads) so SSR matches.
export function Sparkline({
  values,
  width = 120,
  height = 24,
  className,
  title,
}: {
  values: number[]
  width?: number
  height?: number
  className?: string
  title?: string
}) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('text-foreground overflow-visible', className)}
      role="img"
      aria-label={title}>
      {title && <title>{title}</title>}
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
