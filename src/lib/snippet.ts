// Search snippets come from ts_headline over the stored (unredacted) body, so
// strip any addresses before rendering — no email is ever shown (ui.md).
export function redactEmails(s: string): string {
  return s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
}

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
