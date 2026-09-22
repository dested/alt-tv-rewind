// Contracts for the source-aware catalog/import (`bun run pipeline sources …`).
//
// Input side: the organized research bundle under
// data/archives/research-2026-09-21/organized/ (schemaVersion 1, produced by
// plans/2026-09-21-organize-*.py). Every line is parsed through these schemas —
// a bundle written by a different organizer version must fail here, not deep
// in the import. Output side: the catalog/import checkpoint records the stages
// write under data/work/sources/.
import { z } from 'zod'

// ───────────────────────── organized bundle (input) ─────────────────────────

export const ORGANIZED_SCHEMA_VERSION = 1

const iso = z.string().datetime({ offset: true })
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const SourceKind = z.enum(['usenet', 'forum', 'capsule'])
export type SourceKind = z.infer<typeof SourceKind>

export const DatePrecision = z.enum(['second', 'minute', 'day', 'unknown'])
export type DatePrecision = z.infer<typeof DatePrecision>

// organized/sources.json entries and organized/sources/<id>/source.json
export const OrganizedSource = z.object({
  schemaVersion: z.literal(ORGANIZED_SCHEMA_VERSION),
  sourceId: z.string().regex(/^[a-z0-9-]+$/),
  kind: SourceKind,
  name: z.string(),
  homeUrl: z.string().url().nullable(),
  notes: z.array(z.string()),
  groupsRead: z.array(z.string()).optional(),
  records: z.number().int().optional(),
  observations: z.number().int().optional(),
  recordCount: z.number().int().optional(),
  observationCount: z.number().int().optional(),
  bodyVariantObservations: z.number().int().optional(),
  kinds: z.record(z.string(), z.number().int()).optional(),
  datePrecisionCounts: z.record(z.string(), z.number().int()).optional(),
  years: z.record(z.string(), z.number().int()).optional(),
})
export type OrganizedSource = z.infer<typeof OrganizedSource>

const Author = z.object({
  externalId: z.string().nullable(),
  displayName: z.string(),
})

const RecordBase = z.object({
  schemaVersion: z.literal(ORGANIZED_SCHEMA_VERSION),
  recordId: z.string().length(64),
  canonicalId: z.string(),
  sourceId: z.string(),
  externalId: z.string(),
  threadExternalId: z.string().nullable(),
  originalUrl: z.string().nullable(),
  title: z.string(),
  postedAt: iso.nullable(),
  postedDate: ymd.nullable(),
  datePrecision: DatePrecision,
  dateTimezone: z.string().nullable(),
  dateRaw: z.string().nullable(),
  contentSha256: z.string().length(64),
})

// organized/sources/usenet-*/records.jsonl
export const UsenetRecord = RecordBase.extend({
  kind: z.literal('post'),
  identityMethod: z.enum(['message-id', 'raw-sha256']),
  // Nullable: the organizer emits `author: null` for a few raw-sha256 records
  // with no parseable From line (see catalog-usenet's displayName fallback).
  author: Author.nullable(),
  bodyText: z.string(),
  newsgroups: z.array(z.string()),
  references: z.array(z.string()),
  inReplyTo: z.string().nullable(),
  dateHeaders: z.record(z.string(), z.string()),
  dateDerivation: z.string(),
  hasContentConflict: z.boolean().optional(),
  observationCount: z.number().int().optional(),
})
export type UsenetRecord = z.infer<typeof UsenetRecord>

// organized/sources/southpark-official-forum/records.jsonl
export const ForumRecord = RecordBase.extend({
  kind: z.literal('post'),
  // Nullable: 53 posts are from deleted/guest accounts with no display name or
  // account id (their identity fields, and poster_key, stay null in the catalog).
  author: Author.nullable(),
  bodyText: z.string(),
  hasContentConflict: z.boolean(),
  observationCount: z.number().int(),
  editNotice: z.unknown().optional(),
})
export type ForumRecord = z.infer<typeof ForumRecord>

const DocDate = z.object({
  raw: z.string().nullable(),
  date: ymd.nullable(),
  precision: z.string(),
})

// organized/sources/simpsons-archive-capsules/records.jsonl
export const CapsuleRecord = RecordBase.extend({
  kind: z.literal('compiled_document'),
  author: z.null(),
  bodyText: z.string(),
  documentMetadata: z.object({
    productionCode: z.string().optional(),
    originalAirDate: DocDate.optional(),
    revision: z
      .object({ label: z.string().nullable(), raw: z.string().nullable(), date: ymd.nullable(), precision: z.string() })
      .optional(),
    conversionDate: DocDate.optional(),
    rightsNoticeSpans: z.array(z.object({ start: z.number().int(), end: z.number().int(), text: z.string() })),
  }),
  publicationStatus: z.enum(['local_research_only']),
  sourceEncoding: z.string(),
  // The organizer emits `plain_text` for the 111 text capsules (not `text`).
  sourceFormat: z.enum(['html', 'text', 'plain_text']),
  replacementCharacterCount: z.number().int(),
})
export type CapsuleRecord = z.infer<typeof CapsuleRecord>

// organized/sources/<id>/observations.jsonl (union of the three adapters' shapes)
export const OrganizedObservation = z.object({
  schemaVersion: z.literal(ORGANIZED_SCHEMA_VERSION),
  observationId: z.string().length(64),
  recordId: z.string().length(64),
  sourceId: z.string(),
  artifactPath: z.string(),
  artifactSha256: z.string().length(64),
  locator: z.string(),
  originalUrl: z.string().nullable(),
  capturedAt: iso.nullable(),
  retrievedAt: iso.nullable(),
  verifiedAt: iso.nullable().optional(),
  contentSha256: z.string().length(64),
  // usenet
  recordOrdinal: z.number().int().optional(),
  byteOffset: z.number().int().optional(),
  byteLength: z.number().int().optional(),
  rawSha256: z.string().optional(),
  // forum
  bodyText: z.string().optional(),
  capturedPageUrl: z.string().optional(),
  warcRecordId: z.string().optional(),
  warcPayloadDigest: z.string().optional(),
  warcBlockDigest: z.string().optional(),
  archiveCollectionId: z.string().optional(),
  warcUrl: z.string().optional(),
  compressedOffset: z.number().int().optional(),
  compressedLength: z.number().int().optional(),
})
export type OrganizedObservation = z.infer<typeof OrganizedObservation>

// organized/artifacts.jsonl
export const OrganizedArtifact = z.object({
  schemaVersion: z.literal(ORGANIZED_SCHEMA_VERSION),
  artifactId: z.string().length(64),
  sourceIds: z.array(z.string()),
  artifactPath: z.string(),
  artifactSha256: z.string().length(64),
  role: z.string(),
  collectionEvidence: z
    .object({
      derivedFrom: z.string().optional(),
      bytes: z.number().int().optional(),
      verifiedAt: z.string().optional(),
      url: z.string().optional(),
      downloadUrl: z.string().optional(),
      warcUrl: z.string().optional(),
      captureTimestamp: z.string().regex(/^\d{14}$/).optional(), // WARC capture, YYYYMMDDhhmmss UTC
    })
    .passthrough()
    .optional(),
})
export type OrganizedArtifact = z.infer<typeof OrganizedArtifact>

// organized/show-associations.jsonl — the research seeds, not dispositions
export const SeedAssociation = z.object({
  schemaVersion: z.literal(ORGANIZED_SCHEMA_VERSION),
  recordId: z.string().length(64),
  sourceId: z.string(),
  showId: z.string(), // show slug
  status: z.enum(['candidate', 'source_context']),
  episodeId: z.null(),
  evidence: z.string(),
  note: z.string(),
})
export type SeedAssociation = z.infer<typeof SeedAssociation>

// ───────────────────────── fixed facts of this collection ─────────────────────────

export const RESEARCH_DIR = 'data/archives/research-2026-09-21'
export const ORGANIZED_DIR = `${RESEARCH_DIR}/organized`
export const SOURCES_WORK_DIR = 'data/work/sources'

// Which sources are communities *of* a show (every non-spam post is show
// context, like a legacy alt.tv.<show> group) versus general communities that
// need per-record screening.
export const COMMUNITY_SOURCES: Record<string, string> = {
  'usenet-alt-tv-familyguy': 'family-guy',
  'usenet-alt-tv-simpsons-itchy-scratchy': 'simpsons',
}
export const GENERAL_USENET_SOURCES = ['usenet-rec-arts-animation', 'usenet-rec-arts-tv', 'usenet-alt-tv-game-shows'] as const
export const FORUM_SOURCE = 'southpark-official-forum'
export const CAPSULE_SOURCE = 'simpsons-archive-capsules'

// The four collected forum topics → episode slugs (verified against the DB).
export const FORUM_TOPICS: Record<string, { show: string; episode: string; title: string }> = {
  '15576': { show: 'south-park', episode: 's09e13-free-willzyx', title: 'Free Willzyx' },
  '15753': { show: 'south-park', episode: 's09e14-bloody-mary', title: 'Bloody Mary' },
  '18874': { show: 'south-park', episode: 's10e02-smug-alert', title: 'Smug Alert!' },
  '19318': { show: 'south-park', episode: 's10e04-cartoon-wars-part-2', title: 'Cartoon Wars, Part 2' },
}

// Show-name terms for relevance screening in general communities (lowercase,
// matched on word boundaries against subject and unquoted body).
export const SHOW_TERMS: Record<string, string[]> = {
  'family-guy': ['family guy'],
  simpsons: ['simpsons', 'the simpsons'],
  'south-park': ['south park', 'southpark'],
  seinfeld: ['seinfeld'],
}
// Screened shows, in the handoff's execution order.
export const SCREENED_SHOWS = ['family-guy', 'south-park', 'simpsons', 'seinfeld'] as const

// Original-era boundary for reporting (records after it are still cataloged
// and importable as retro discussion; they are just not "in era").
export const ERA_END = '2009-12-31'

// Source-location facts that are not in the bundle.
export const SOURCE_FACTS: Record<
  string,
  {
    communityKey: string
    custodian: string
    collectionUrl: string | null
    originalStatus: 'live' | 'offline' | 'unknown'
    publication: 'public' | 'metadata_only'
  }
> = {
  'usenet-rec-arts-tv': {
    communityKey: 'rec.arts.tv',
    custodian: 'Internet Archive (usenet-rec collection)',
    collectionUrl: 'https://archive.org/details/usenet-rec',
    originalStatus: 'unknown',
    publication: 'public',
  },
  'usenet-rec-arts-animation': {
    communityKey: 'rec.arts.animation',
    custodian: 'Internet Archive (usenet-rec collection)',
    collectionUrl: 'https://archive.org/details/usenet-rec',
    originalStatus: 'unknown',
    publication: 'public',
  },
  'usenet-alt-tv-game-shows': {
    communityKey: 'alt.tv.game-shows',
    custodian: 'Internet Archive (usenet-alt collection)',
    collectionUrl: 'https://archive.org/details/usenet-alt',
    originalStatus: 'unknown',
    publication: 'public',
  },
  'usenet-alt-tv-familyguy': {
    communityKey: 'alt.tv.familyguy',
    custodian: 'Internet Archive (usenet-alt collection)',
    collectionUrl: 'https://archive.org/details/usenet-alt',
    originalStatus: 'unknown',
    publication: 'public',
  },
  'usenet-alt-tv-simpsons-itchy-scratchy': {
    communityKey: 'alt.tv.simpsons.itchy-scratchy',
    custodian: 'Internet Archive (usenet-alt collection)',
    collectionUrl: 'https://archive.org/details/usenet-alt',
    originalStatus: 'unknown',
    publication: 'public',
  },
  'southpark-official-forum': {
    communityKey: 'southpark.cc.com/forum',
    custodian: 'Archive Team / Internet Archive',
    collectionUrl: 'https://archive.org/details/southpark.cc.com_forum_20240110',
    // Probed 2026-09-21: the original permalinks return 404; Wayback replays exist.
    originalStatus: 'offline',
    publication: 'public',
  },
  'simpsons-archive-capsules': {
    communityKey: 'simpsonsarchive.com/episodes',
    custodian: 'simpsonsarchive.com',
    collectionUrl: null,
    // Probed 2026-09-21: capsule pages return 200.
    originalStatus: 'live',
    publication: 'metadata_only',
  },
}

// ───────────────────────── checkpoints (data/work/sources/, gitignored) ─────────────────────────

// Fingerprint of the inputs a checkpoint was computed from. Stages refuse to
// reuse a checkpoint whose fingerprint differs (stale keys would attach
// classifications to the wrong conversation).
export const InputFingerprint = z.object({
  organizedBuiltAt: z.string(), // organized/summary.json builtAt
  recordCount: z.number().int(),
  observationCount: z.number().int(),
  extractorVersion: z.string(), // bump when screening/threading rules change
  schemaVersion: z.literal(ORGANIZED_SCHEMA_VERSION),
})
export type InputFingerprint = z.infer<typeof InputFingerprint>

export const AssociationStatus = z.enum(['accepted', 'context', 'excluded', 'needs_review'])
export type AssociationStatus = z.infer<typeof AssociationStatus>

// One disposition per (record, show) — the screening output the import reads.
export const Disposition = z.object({
  recordId: z.string().length(64),
  sourceId: z.string(),
  show: z.string(), // show slug
  status: AssociationStatus,
  method: z.string(),
  evidence: z.string(),
  confidence: z.number().int().min(0).max(100).nullable(),
  reason: z.string().nullable(),
  conversationKey: z.string().nullable(),
  inEra: z.boolean(),
  episodeSlug: z.string().nullable(), // set by forum/capsule cataloging; usenet episodes come from attribution
  seed: z.boolean(), // was in show-associations.jsonl
})
export type Disposition = z.infer<typeof Disposition>

// A Usenet conversation across the five sources: per-source JWZ threads
// unioned by shared canonical ids and by References that resolve into another
// thread. Subject-only merging never crosses a source.
export const Conversation = z.object({
  key: z.string(), // "c:" + first 16 hex of sha256(earliest member's canonicalId)
  members: z.array(
    z.object({
      recordId: z.string().length(64),
      canonicalId: z.string(),
      sourceId: z.string(),
      // The same canonical post seen in other sources (crossposts): their
      // record ids, so the import can attach additional memberships.
      additionalRecordIds: z.array(z.string().length(64)),
      parentCanonicalId: z.string().nullable(), // resolved within the conversation
      depth: z.number().int(),
      sortAt: z.string(), // ISO; the record's own instant, else inherited (see inheritedDate)
      inheritedDate: z.boolean(),
    })
  ),
  earliestAt: z.string(),
  subjectNorm: z.string(),
  sources: z.array(z.string()),
})
export type Conversation = z.infer<typeof Conversation>

// ───────────────────────── stage entry points ─────────────────────────

export type CatalogOpts = {
  dryRun: boolean // compute everything, write checkpoints, touch no DB row
  sources?: string[] // restrict to these source keys
  log: (msg: string) => void
}

export type ImportOpts = {
  show: string
  dryRun: boolean
  sources?: string[]
  force: boolean // ignore existing import checkpoints for this show
  log: (msg: string) => void
}
