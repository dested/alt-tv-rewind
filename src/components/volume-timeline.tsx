import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RouterOutputs } from '~/lib/api-types'
import { compact, episodeCode, formatAirDate, formatNumber } from '~/lib/format'

type Timeline = RouterOutputs['shows']['timeline']

const WEEK = 7 * 24 * 3600 * 1000

// Plot geometry in viewBox units.
const VB_W = 1000
const VB_H = 220
const X0 = 40
const X1 = 990
const Y0 = 10
const Y1 = 180
const PLOT_W = X1 - X0
const PLOT_H = Y1 - Y0

// UTC Monday of a 'YYYY-MM-DD' day, as ms. Kept in UTC so the same day maps to
// the same week on the server and in every reader's browser.
function mondayUTC(dayIso: string): number {
  const d = new Date(`${dayIso}T00:00:00Z`)
  const offset = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset)
}

// Noon UTC of a date-only string, so it lands inside its day regardless of zone.
function dateMs(dayIso: string): number {
  return new Date(`${dayIso.slice(0, 10)}T12:00:00Z`).getTime()
}

// Round up to the next 1/2/5 × 10ⁿ so the axis reads in clean steps.
function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  const frac = value / base
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return step * base
}

type Week = { ms: number; iso: string; messages: number }

export function VolumeTimeline({
  days,
  episodes,
  seasons,
  showSlug,
}: {
  days: Timeline['days']
  episodes: Timeline['episodes']
  seasons: Timeline['seasons']
  showSlug: string
}) {
  const navigate = useNavigate()
  // null on the server and first client render, so the two markups match.
  const [hover, setHover] = useState<number | null>(null)

  if (days.length === 0) {
    return <p className="text-muted-foreground text-sm">No posts yet</p>
  }

  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  if (!firstDay || !lastDay) {
    return <p className="text-muted-foreground text-sm">No posts yet</p>
  }

  const first = mondayUTC(firstDay.day)
  const last = mondayUTC(lastDay.day)
  const weekCount = Math.round((last - first) / WEEK) + 1

  const byWeek = new Map<number, number>()
  for (const d of days) {
    const ms = mondayUTC(d.day)
    byWeek.set(ms, (byWeek.get(ms) ?? 0) + d.messages)
  }
  const weeks: Week[] = []
  for (let i = 0; i < weekCount; i++) {
    const ms = first + i * WEEK
    weeks.push({ ms, iso: new Date(ms).toISOString().slice(0, 10), messages: byWeek.get(ms) ?? 0 })
  }

  const totalSpan = weekCount * WEEK
  const x = (ms: number) => X0 + ((ms - first) / totalSpan) * PLOT_W
  const barW = Math.max(PLOT_W / weekCount, 0.5)

  const yMax = niceMax(Math.max(...weeks.map((w) => w.messages), 1))
  const y = (value: number) => Y1 - (value / yMax) * PLOT_H

  const episodeMs = episodes.map((e) => ({ ...e, ms: dateMs(e.airDate) }))
  function nearestEpisode(weekMs: number) {
    let best: (typeof episodeMs)[number] | null = null
    let bestDist = Infinity
    for (const e of episodeMs) {
      const dist = Math.abs(e.ms - weekMs)
      if (dist < bestDist) {
        best = e
        bestDist = dist
      }
    }
    return best && bestDist <= WEEK ? best : null
  }

  const firstYear = new Date(first).getUTCFullYear()
  const lastYear = new Date(last).getUTCFullYear()
  const januaries: number[] = []
  for (let year = firstYear; year <= lastYear + 1; year++) {
    const ms = Date.UTC(year, 0, 1)
    if (ms >= first && ms <= last + WEEK) januaries.push(ms)
  }

  const gridFractions = [0.25, 0.5, 0.75]

  const hovered = hover !== null ? (weeks[hover] ?? null) : null
  const hoveredEpisode = hovered ? nearestEpisode(hovered.ms) : null
  const hoveredCenterX = hovered ? x(hovered.ms) + barW / 2 : 0

  function weekAt(clientX: number, rect: DOMRect): number | null {
    const i = Math.floor(((clientX - rect.left) / rect.width) * weekCount)
    if (i < 0 || i >= weekCount) return null
    return i
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label={`Weekly post volume, ${firstYear} to ${lastYear}`}>
        {/* Season bands, behind everything else. */}
        {seasons.map((s) =>
          s.premiered && s.ended ? (
            <rect
              key={`band-${s.number}`}
              x={x(dateMs(s.premiered))}
              y={Y0}
              width={Math.max(x(dateMs(s.ended)) - x(dateMs(s.premiered)), 0.5)}
              height={PLOT_H}
              className="fill-foreground/[0.04]"
            />
          ) : null
        )}

        {/* Gridlines + value labels. */}
        {gridFractions.map((frac) => (
          <g key={`grid-${frac}`}>
            <line
              x1={X0}
              x2={X1}
              y1={y(yMax * frac)}
              y2={y(yMax * frac)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={X0 - 4}
              y={y(yMax * frac) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]">
              {compact(Math.round(yMax * frac))}
            </text>
          </g>
        ))}

        {/* Weekly bars. */}
        <g className="text-foreground/60">
          {weeks.map((w, i) =>
            w.messages > 0 ? (
              <rect
                key={w.ms}
                x={x(w.ms)}
                y={y(w.messages)}
                width={barW}
                height={Y1 - y(w.messages)}
                fill="currentColor"
                className={hover === i ? 'text-foreground' : undefined}
              />
            ) : null
          )}
        </g>

        {/* Air-date ticks along the baseline. */}
        {episodeMs.map((e) => {
          const ex = x(e.ms)
          return ex >= X0 && ex <= X1 ? (
            <line
              key={`tick-${e.slug}`}
              x1={ex}
              x2={ex}
              y1={182}
              y2={190}
              className="stroke-brand"
              strokeWidth={1}
            />
          ) : null
        })}

        {/* Year gridlines + labels. */}
        {januaries.map((ms) => (
          <g key={`year-${ms}`}>
            <line
              x1={x(ms)}
              x2={x(ms)}
              y1={Y1}
              y2={Y1 + 6}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={x(ms)}
              y={210}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]">
              {new Date(ms).getUTCFullYear()}
            </text>
          </g>
        ))}

        {/* Hover crosshair. */}
        {hovered && (
          <line
            x1={hoveredCenterX}
            x2={hoveredCenterX}
            y1={Y0}
            y2={Y1}
            className="stroke-foreground/40"
            strokeWidth={1}
          />
        )}

        {/* Invisible hit area covering the plot; drives hover + click. */}
        <rect
          x={X0}
          y={Y0}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onMouseMove={(e) => setHover(weekAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onMouseLeave={() => setHover(null)}
          onClick={() => {
            if (hoveredEpisode) navigate(`/${showSlug}/${hoveredEpisode.slug}`)
          }}
        />
      </svg>

      {hovered && (
        <div
          className="bg-popover text-popover-foreground pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(hoveredCenterX / VB_W) * 100}%` }}>
          <div className="tabular-nums">
            Week of {formatAirDate(hovered.iso, 'short')} · {formatNumber(hovered.messages)} posts
          </div>
          {hoveredEpisode && (
            <div className="text-muted-foreground">
              {episodeCode(hoveredEpisode.seasonNumber, hoveredEpisode.number)}{' '}
              {hoveredEpisode.title} · aired{' '}
              {formatAirDate(hoveredEpisode.airDate, 'short').replace(/, \d{4}$/, '')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
