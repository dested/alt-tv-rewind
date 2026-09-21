// Shared string helpers used across the episodes, attribute, and stats stages.
// Kept dependency-free so tests can exercise them in isolation.

// URL-safe slug: "The Mom & Pop Store" → "the-mom-and-pop-store".
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

// Strip HTML down to plain text: block/line tags become spaces, the listed
// entities are decoded, everything is whitespace-collapsed.
export function stripHtml(s: string): string {
  return s
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<\s*\/?\s*p\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => NAMED_ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

const ATTRIBUTION = /^(On .* wrote:|.* writes:|In article <.*>.*)$/

// Remove quoted lines (`>`/`|` prefixes) and attribution lines so the body we
// score against is the poster's own words, not the message being replied to.
export function withoutQuotedLines(body: string): string {
  return body
    .split('\n')
    .filter((line) => {
      const t = line.trimStart()
      if (t.startsWith('>') || t.startsWith('|')) return false
      if (ATTRIBUTION.test(line.trim())) return false
      return true
    })
    .join('\n')
}

const PART_SUFFIX = /\s*(\(part\s*\d+\)|\(\d+\)|,?\s*part\s+\d+)\s*$/i

// Canonical form of an episode/alias title for matching: no leading "the",
// no "(1)"/"part 2" suffix, punctuation flattened to single spaces.
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(PART_SUFFIX, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
