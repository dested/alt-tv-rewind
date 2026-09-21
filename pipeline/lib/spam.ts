// Heuristic spam detection over parsed messages. Returns the first matching
// reason, or null. Ordering matters: cheap structural signals before keyword
// scans.

const KEYWORDS: RegExp[] = [
  /\bviagra\b/i,
  /\bcialis\b/i,
  /\bcasino\b/i,
  /\bporn\b/i,
  /\bxxx\b/i,
  /\bsex pics\b/i,
  /\bsex videos\b/i,
  /\bmake money\b/i,
  /\bearn \$/i,
  /\$\$\$/,
  /\bfree money\b/i,
  /\bfree cash\b/i,
  /\bmortgage\b/i,
  /\brefinance\b/i,
  /\brolex\b/i,
  /\breplica watches\b/i,
  /\bpenis\b/i,
  /\benlarge\b/i,
  /\bdating site\b/i,
  /\bhot girls\b/i,
  /\bhot singles\b/i,
  /\basian ladies\b/i,
  /\brussian brides\b/i,
  /\brussian women\b/i,
  /\bweight loss\b/i,
  /\bdiet pills\b/i,
  /\bwork from home\b/i,
  /\bnigerian\b/i,
  /\blottery winner\b/i,
  /\bclick here\b/i,
  /\bunsubscribe here\b/i,
  /\bcheap software\b/i,
  /\boem software\b/i,
  /\bphentermine\b/i,
  /\bhydrocodone\b/i,
]

function isShouting(subject: string, postedAt: string | null): boolean {
  if (subject.length < 20) return false
  if (!/[A-Z]/.test(subject) || /[a-z]/.test(subject)) return false
  if (postedAt === null) return false
  return new Date(postedAt).getUTCFullYear() >= 2003
}

export function detectSpam(m: {
  subject: string
  body: string
  newsgroups: string[]
  postedAt: string | null
}): string | null {
  if (m.newsgroups.length > 6) return 'crosspost'
  const urls = m.body.match(/https?:\/\/|www\./gi)
  if (urls !== null && urls.length >= 8) return 'urls'
  if (KEYWORDS.some((re) => re.test(m.subject))) return 'subject-keyword'
  let distinct = 0
  for (const re of KEYWORDS) {
    if (re.test(m.body)) {
      distinct++
      if (distinct >= 2) return 'body-keywords'
    }
  }
  if (isShouting(m.subject, m.postedAt)) return 'shouting'
  return null
}
