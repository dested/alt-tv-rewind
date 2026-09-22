import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { SourceLocationData } from '~/lib/api-types'
import { cn } from '~/lib/utils'

// Where a post can be found. Two modes:
// - full: the source name plus every available link, joined by " · ".
// - compact: just the source name (for the transcript / reply gutters), linking
//   to the preserved record when one exists, with a " +n" hint for crossposts.
export function SourceLine({
  location,
  compact = false,
  additionalSourceCount = 0,
  className,
}: {
  location: SourceLocationData
  compact?: boolean
  additionalSourceCount?: number
  className?: string
}) {
  const { source } = location

  if (compact) {
    const to = location.preservedPath ?? `/sources/${source.key}`
    return (
      <span className={cn('text-muted-foreground text-xs', className)}>
        <Link to={to} className="text-link hover:underline">
          {source.name}
        </Link>
        {additionalSourceCount > 0 && (
          <span title={`also seen in ${additionalSourceCount} other sources`}>
            {' '}
            +{additionalSourceCount}
          </span>
        )}
      </span>
    )
  }

  const isDocument = source.kind === 'capsule'
  const segments: ReactNode[] = [
    <Link key="name" to={`/sources/${source.key}`} className="text-link hover:underline">
      {source.name}
    </Link>,
  ]

  if (location.originalUrl && location.originalStatus !== 'offline') {
    segments.push(
      <a key="original" href={location.originalUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
        {isDocument ? 'Original document' : 'Original post'}
      </a>
    )
  } else if (location.originalUrl && location.originalStatus === 'offline') {
    segments.push(
      <span key="original-offline" title={location.originalUrl}>
        Original post offline
      </span>
    )
  }
  if (location.archivedUrl) {
    segments.push(
      <a key="archived" href={location.archivedUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
        Archived copy
      </a>
    )
  }
  if (location.collectionUrl) {
    segments.push(
      <a key="collection" href={location.collectionUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
        Archive collection
      </a>
    )
  }
  if (location.preservedPath) {
    segments.push(
      <Link key="preserved" to={location.preservedPath} className="text-link hover:underline">
        Preserved record
      </Link>
    )
  }
  if (location.browseUrl && location.originalUrl === null) {
    segments.push(
      <a key="browse" href={location.browseUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
        Browse source
      </a>
    )
  }
  if (location.captureCount > 1) {
    segments.push(<span key="captures">{location.captureCount} captures</span>)
  }

  return (
    <div className={cn('text-muted-foreground text-xs', className)}>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden> · </span>}
          {seg}
        </Fragment>
      ))}
    </div>
  )
}
