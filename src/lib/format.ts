// Every date the UI shows goes through here with a fixed locale + zone so the
// SSR string and the hydrated string are byte-identical (Bun and browsers both
// ship full ICU). Air dates and post times are shown in the network's zone.
export const AIR_TZ = 'America/New_York'
const LOCALE = 'en-US'

const formatters = new Map<string, Intl.DateTimeFormat>()
function dtf(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, options)
    formatters.set(key, f)
  }
  return f
}

// "1996-05-16" → "Thursday, May 16, 1996" (date-only: format at UTC so no zone shift)
export function formatAirDate(isoDate: string, style: 'long' | 'short' = 'long'): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`)
  return style === 'long'
    ? dtf({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
    : dtf({ month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
}

// ISO instant → "May 17, 1996"
export function formatDate(iso: string): string {
  return dtf({ month: 'short', day: 'numeric', year: 'numeric', timeZone: AIR_TZ }).format(
    new Date(iso)
  )
}

// ISO instant → "May 17, 1996, 9:12 AM ET"
export function formatDateTime(iso: string): string {
  return `${dtf({
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: AIR_TZ,
  }).format(new Date(iso))} ET`
}

// ISO instant → "9:12 AM"
export function formatTime(iso: string): string {
  return dtf({ hour: 'numeric', minute: '2-digit', timeZone: AIR_TZ }).format(new Date(iso))
}

// "1996-05" or ISO → "May 1996"
export function formatMonth(value: string): string {
  const d = value.length === 7 ? new Date(`${value}-15T12:00:00Z`) : new Date(value)
  return dtf({ month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

export function formatYear(iso: string): string {
  return dtf({ year: 'numeric', timeZone: AIR_TZ }).format(new Date(iso))
}

function hourInAirZone(iso: string): number {
  const part = dtf({ hour: 'numeric', hourCycle: 'h23', timeZone: AIR_TZ })
    .formatToParts(new Date(iso))
    .find((p) => p.type === 'hour')
  return part ? Number(part.value) : 0
}

// How long after the episode aired a post landed, in editorial phrasing.
export function relativeToAir(hoursAfterAir: number | null, postedAt: string): string | null {
  if (hoursAfterAir === null) return null
  const h = hoursAfterAir
  if (h < -24) return `${Math.round(-h / 24)} days before it aired`
  if (h < -1) return `${Math.round(-h)} hours before it aired`
  if (h < 0) return 'minutes before it aired'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes after the credits`
  if (h < 6) return `${Math.round(h)} hours after the credits`
  const posted = hourInAirZone(postedAt)
  if (h < 30 && posted >= 5 && posted < 12) return 'the next morning'
  if (h < 18) return `${Math.round(h)} hours later`
  if (h < 48) return 'the next day'
  if (h < 24 * 14) return `${Math.round(h / 24)} days later`
  if (h < 24 * 60) return `${Math.round(h / 24 / 7)} weeks later`
  if (h < 24 * 365 * 1.5) return `${Math.round(h / 24 / 30)} months later`
  return `${Math.round(h / 24 / 365)} years later`
}

const compactFormatter = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
const plainFormatter = new Intl.NumberFormat(LOCALE)

// 157381 → "157K"; 981 → "981"
export function compact(n: number): string {
  return n < 1000 ? String(n) : compactFormatter.format(n)
}

export function formatNumber(n: number): string {
  return plainFormatter.format(n)
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`
}

export function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
}
