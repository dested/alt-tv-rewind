import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RouterOutputs } from '~/lib/api-types'
import { episodeCode, formatNumber } from '~/lib/format'

const VB_W = 600
const VB_H = 320
const X0 = 44
const X1 = 580
const Y0 = 20
const Y1 = 280

const MINUS = '−'
function signed(n: number): string {
  return `${n < 0 ? MINUS : '+'}${Math.abs(n).toFixed(1)}`
}

function zScores(values: number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  const std = Math.sqrt(variance)
  return std === 0 ? values.map(() => 0) : values.map((v) => (v - mean) / std)
}

export function ThenVsNow({
  items,
  showSlug,
}: {
  items: RouterOutputs['shows']['thenVsNow']
  showSlug: string
}) {
  const navigate = useNavigate()
  const [hover, setHover] = useState<number | null>(null)

  if (items.length < 5) return null

  const ratings = items.map((e) => e.tvmazeRating)
  const rawMin = Math.min(...ratings)
  const rawMax = Math.max(...ratings)
  let xMin = Math.floor(rawMin - 0.2)
  let xMax = Math.ceil(rawMax + 0.2)
  if (xMax - xMin < 1) xMax = xMin + 1

  const px = (rating: number) => X0 + ((rating - xMin) / (xMax - xMin)) * (X1 - X0)
  const py = (score: number) => Y0 + ((1 - score) / 2) * (Y1 - Y0)

  // Residual = how much better it read on Usenet than TVMaze rates it today.
  const zx = zScores(items.map((e) => e.tvmazeRating))
  const zy = zScores(items.map((e) => e.usenetScore))
  const residuals = items.map((_, i) => (zy[i] ?? 0) - (zx[i] ?? 0))
  let maxIdx = 0
  let minIdx = 0
  residuals.forEach((r, i) => {
    if (r > (residuals[maxIdx] ?? -Infinity)) maxIdx = i
    if (r < (residuals[minIdx] ?? Infinity)) minIdx = i
  })
  const labels = new Map<number, string>()
  if (maxIdx !== minIdx) {
    labels.set(maxIdx, 'overrated then')
    labels.set(minIdx, 'underrated then')
  }

  const integerTicks: number[] = []
  for (let r = Math.ceil(xMin); r <= Math.floor(xMax); r++) integerTicks.push(r)

  const hovered = hover !== null ? (items[hover] ?? null) : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full max-w-2xl">
        {/* Zero line for the Usenet score. */}
        <line
          x1={X0}
          x2={X1}
          y1={py(0)}
          y2={py(0)}
          className="stroke-border"
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Y axis + labels. */}
        <line x1={X0} x2={X0} y1={Y0} y2={Y1} className="stroke-border" strokeWidth={1} />
        {[1, 0, -1].map((v) => (
          <text
            key={`y-${v}`}
            x={X0 - 8}
            y={py(v) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]">
            {v > 0 ? '+1' : v < 0 ? `${MINUS}1` : '0'}
          </text>
        ))}

        {/* X axis + integer rating labels. */}
        <line x1={X0} x2={X1} y1={Y1} y2={Y1} className="stroke-border" strokeWidth={1} />
        {integerTicks.map((r) => (
          <g key={`x-${r}`}>
            <line
              x1={px(r)}
              x2={px(r)}
              y1={Y1}
              y2={Y1 + 5}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={px(r)}
              y={Y1 + 18}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px] tabular-nums">
              {formatNumber(r)}
            </text>
          </g>
        ))}

        {/* Dots + direct labels + generous hit targets. */}
        {items.map((e, i) => {
          const cx = px(e.tvmazeRating)
          const cy = py(e.usenetScore)
          const label = labels.get(i)
          return (
            <g key={e.slug}>
              <circle cx={cx} cy={cy} r={4} className="fill-foreground/70" />
              {label && (
                <text x={cx + 8} y={cy - 4} className="fill-foreground text-[11px]">
                  {episodeCode(e.seasonNumber, e.number)} · {label}
                </text>
              )}
              <circle
                cx={cx}
                cy={cy}
                r={12}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => navigate(`/${showSlug}/${e.slug}`)}
              />
            </g>
          )
        })}
      </svg>

      {hovered && (
        <div
          className="bg-popover text-popover-foreground pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(px(hovered.tvmazeRating) / VB_W) * 100}%` }}>
          {episodeCode(hovered.seasonNumber, hovered.number)} {hovered.title} · Usenet{' '}
          {signed(hovered.usenetScore)} · TVMaze {formatNumber(hovered.tvmazeRating)}
        </div>
      )}
    </div>
  )
}
