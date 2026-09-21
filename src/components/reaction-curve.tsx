import { useState } from 'react'
import { formatAirDate, plural } from '~/lib/format'

// Reaction bars per calendar day after the air date (−1d…+14d), brand fill —
// day resolution because most 1990s posts carried no time of day. Deterministic
// SVG so SSR and client markup match; the hover tooltip only appears after a
// pointer event (initial state null → identical first render on both sides).

const VIEW_W = 1000
const VIEW_H = 120
const PLOT_LEFT = 10
const PLOT_RIGHT = 990
const PLOT_TOP = 8
const BASELINE = 96
const DAY_MS = 86_400_000

export function ReactionCurve({
  points,
  airDate,
}: {
  points: Array<{ day: number; messages: number }>
  airDate: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)

  const first = points[0]
  if (!first || points.every((p) => p.messages === 0)) return null

  const minDay = first.day
  const lastDay = points[points.length - 1]?.day ?? minDay
  const max = Math.max(...points.map((p) => p.messages), 1)
  const slot = (PLOT_RIGHT - PLOT_LEFT) / points.length
  const barW = Math.max(slot - 1, 0.5)
  const centerForDay = (d: number): number => PLOT_LEFT + (d - minDay) * slot + barW / 2

  const airMs = new Date(`${airDate.slice(0, 10)}T12:00:00Z`).getTime()
  const dayMarks = [1, 7, 14].filter((d) => d <= lastDay)

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Reaction curve">
      {dayMarks.map((d) => (
        <line
          key={`d${d}`}
          x1={centerForDay(d)}
          x2={centerForDay(d)}
          y1={PLOT_TOP}
          y2={100}
          className="stroke-border"
          strokeWidth={1}
        />
      ))}

      {points.map((p, i) => {
        const height = (p.messages / max) * (BASELINE - PLOT_TOP)
        const x = PLOT_LEFT + i * slot
        return (
          <g key={p.day}>
            <rect x={x} y={BASELINE - height} width={barW} height={height} className="fill-brand" />
            <rect
              x={x}
              y={PLOT_TOP}
              width={slot}
              height={BASELINE - PLOT_TOP}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          </g>
        )
      })}

      {/* Air-day marker */}
      <line
        x1={centerForDay(0)}
        x2={centerForDay(0)}
        y1={4}
        y2={100}
        className="stroke-foreground/50"
        strokeWidth={1}
      />
      <text x={centerForDay(0) + 3} y={14} className="fill-muted-foreground text-[11px]">
        aired
      </text>

      {/* Axis labels */}
      <text x={PLOT_LEFT} y={114} className="fill-muted-foreground text-[11px]">
        {`${minDay}d`}
      </text>
      {dayMarks.map((d) => (
        <text
          key={`l${d}`}
          x={centerForDay(d)}
          y={114}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]">
          {`+${d}d`}
        </text>
      ))}

      {hovered !== null &&
        (() => {
          const p = points[hovered]
          if (!p) return null
          const iso = new Date(airMs + p.day * DAY_MS).toISOString()
          const label = `${formatAirDate(iso, 'short')} · ${plural(p.messages, 'post')}`
          const barX = PLOT_LEFT + hovered * slot
          const anchorEnd = barX > (PLOT_LEFT + PLOT_RIGHT) / 2
          const width = Math.min(label.length * 5.6 + 10, 520)
          const boxX = Math.max(
            2,
            Math.min(anchorEnd ? barX + barW - width : barX, VIEW_W - width - 2)
          )
          return (
            <g>
              <rect
                x={boxX}
                y={2}
                width={width}
                height={16}
                rx={3}
                className="fill-card stroke-border"
                strokeWidth={1}
              />
              <text x={boxX + 5} y={13} className="fill-foreground text-[11px]">
                {label}
              </text>
            </g>
          )
        })()}
    </svg>
  )
}
