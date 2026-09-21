import { useState } from 'react'
import { formatDateTime, plural } from '~/lib/format'

// Hourly reaction bars over the live window (−6h…96h), brand fill. Deterministic
// SVG so SSR and client markup match; the hover tooltip only appears after a
// pointer event (initial state null → identical first render on both sides).

const VIEW_W = 1000
const VIEW_H = 120
const PLOT_LEFT = 10
const PLOT_RIGHT = 990
const PLOT_TOP = 8
const BASELINE = 96

export function ReactionCurve({
  points,
  airStamp,
}: {
  points: Array<{ hour: number; messages: number }>
  airStamp: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)

  if (points.length === 0 || points.every((p) => p.messages === 0)) return null

  const first = points[0]
  if (!first) return null
  const minHour = first.hour
  const max = Math.max(...points.map((p) => p.messages), 1)
  const slot = (PLOT_RIGHT - PLOT_LEFT) / points.length
  const barW = Math.max(slot - 1, 0.5)
  const xForHour = (h: number): number => PLOT_LEFT + (h - minHour) * slot

  const airInstant = new Date(airStamp).getTime()
  const dividers = [24, 48, 72].filter((h) => h <= (points[points.length - 1]?.hour ?? 0))

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-auto w-full" role="img" aria-label="Reaction curve">
      {dividers.map((h) => (
        <line
          key={`d${h}`}
          x1={xForHour(h)}
          x2={xForHour(h)}
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
          <g key={p.hour}>
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

      {/* Air-time marker */}
      <line
        x1={xForHour(0)}
        x2={xForHour(0)}
        y1={4}
        y2={100}
        className="stroke-foreground/50"
        strokeWidth={1}
      />
      <text x={xForHour(0) + 3} y={14} className="fill-muted-foreground text-[11px]">
        aired
      </text>

      {/* Axis labels */}
      <text x={PLOT_LEFT} y={114} className="fill-muted-foreground text-[11px]">
        −6h
      </text>
      {dividers.map((h, i) => (
        <text
          key={`l${h}`}
          x={xForHour(h)}
          y={114}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]">
          {`+${i + 1}d`}
        </text>
      ))}

      {hovered !== null &&
        (() => {
          const p = points[hovered]
          if (!p) return null
          const startIso = new Date(airInstant + p.hour * 3_600_000).toISOString()
          const label = `${formatDateTime(startIso)} · ${plural(p.messages, 'post')}`
          const barX = PLOT_LEFT + hovered * slot
          const anchorEnd = barX > (PLOT_LEFT + PLOT_RIGHT) / 2
          const width = Math.min(label.length * 5.6 + 10, 520)
          const boxX = Math.max(2, Math.min(anchorEnd ? barX + barW - width : barX, VIEW_W - width - 2))
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
