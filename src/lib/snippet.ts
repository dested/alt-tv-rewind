// Produces the ONLY HTML fed to dangerouslySetInnerHTML in the app: a search
// snippet, HTML-escaped first, then with the ts_headline control markers
// (U+0001 / U+0002) swapped for <mark>. Never trusts raw snippet HTML.
export function snippetToHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(//g, '<mark>')
    .replace(//g, '</mark>')
    .replace(/\s+/g, ' ')
}
