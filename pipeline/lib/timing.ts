// Air-date timing on ET calendar days — the one rule every relation/timing
// decision follows (decisions.md 2026-09-21 "Date-only headers are a first-class
// state; reaction analysis is per ET calendar day"). Mirrors
// server/routers/shared.ts daysBetweenAirAndPost; keep the two in step.

const etDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const DAY_MS = 86_400_000

// 'YYYY-MM-DD' of an instant in America/New_York. Date-only posts sit at
// 12:00Z, which is the same ET date, so they bucket correctly.
export function etCalendarDay(instantMs: number): string {
  return etDate.format(new Date(instantMs))
}

// Calendar days from the air date (a 'YYYY-MM-DD' at 00:00Z, as stored) to the
// post, counted in ET. Negative = before the air date.
export function daysAfterAir(airDateMs: number, postedAtMs: number): number {
  const postedDay = Date.parse(`${etCalendarDay(postedAtMs)}T00:00:00Z`)
  return Math.round((postedDay - airDateMs) / DAY_MS)
}

export function isLive(days: number, liveWindowDays: number): boolean {
  return days >= -1 && days <= liveWindowDays
}

// Per-post timing against one episode. `before` = more than a day before the
// air date (anticipation), `live` = inside the show's live window, `later` =
// after it. Undated posts never reach here — callers pass `unknown` themselves.
export type PostTiming = 'before' | 'live' | 'later' | 'unknown'

export function postTiming(days: number, liveWindowDays: number): PostTiming {
  if (days < -1) return 'before'
  if (days <= liveWindowDays) return 'live'
  return 'later'
}
