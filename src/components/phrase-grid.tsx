import { Link } from 'react-router-dom'
import { Sparkline } from '~/components/sparkline'
import type { RouterOutputs } from '~/lib/api-types'
import { formatDate, formatNumber } from '~/lib/format'

type Phrase = RouterOutputs['shows']['phrases'][number]

// 'YYYY-MM' → months since year 0, for a contiguous fill.
function monthIndex(month: string): number {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return year * 12 + (m - 1)
}

// The API returns only the months a phrase was said; the sparkline wants a
// dense series, so gaps between the first and last month become zeros.
function filledMonthly(monthly: Phrase['monthly']): number[] {
  const first = monthly[0]
  const last = monthly[monthly.length - 1]
  if (!first || !last) return []
  const counts = new Map(monthly.map((m) => [monthIndex(m.month), m.count]))
  const values: number[] = []
  for (let i = monthIndex(first.month); i <= monthIndex(last.month); i++) {
    values.push(counts.get(i) ?? 0)
  }
  return values
}

export function PhraseGrid({
  phrases,
  showSlug,
}: {
  phrases: RouterOutputs['shows']['phrases']
  showSlug: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {phrases.map((phrase) => {
        const values = filledMonthly(phrase.monthly)
        return (
          <div key={phrase.slug} className="bg-card rounded-xl border p-4">
            <div className="font-serif text-lg font-medium">{phrase.label}</div>
            <div className="text-muted-foreground text-sm">
              {phrase.firstAt ? `first said ${formatDate(phrase.firstAt)}` : 'first said long ago'}
              {phrase.episodeSlug && (
                <>
                  {' · in '}
                  <Link
                    to={`/${showSlug}/${phrase.episodeSlug}`}
                    className="hover:text-foreground underline">
                    the episode
                  </Link>
                </>
              )}
              {phrase.firstThreadId !== null && (
                <>
                  {' · '}
                  <Link
                    to={`/${showSlug}/thread/${phrase.firstThreadId}`}
                    className="hover:text-foreground underline">
                    the thread
                  </Link>
                </>
              )}
            </div>
            <div className="mt-2">
              <Sparkline
                values={values}
                width={160}
                height={28}
                title={`${phrase.label}: ${formatNumber(phrase.totalCount)} mentions over time`}
              />
            </div>
            <div className="text-muted-foreground mt-1 text-xs tabular-nums">
              {formatNumber(phrase.totalCount)} mentions
            </div>
          </div>
        )
      })}
    </div>
  )
}
