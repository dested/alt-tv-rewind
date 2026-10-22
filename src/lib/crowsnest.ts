// Crowsnest (cn.dested.com) custom events. The tag in index.html captures
// pageviews, clicks, referrers, engagement and vitals on its own; this file is
// only for facts the URL can't carry. `window.cn` exists once the deferred
// script has run and never on localhost, so every call is a no-op without it.
// Props must never identify a visitor (no names, ids, or typed text).

type Props = Record<string, string | number | boolean | null>

declare global {
  interface Window {
    cn?: (name: string, props?: Props) => void
  }
}

export function cnEvent(name: string, props?: Props): void {
  if (typeof window === 'undefined') return
  // The deferred script can land after a fast first render; retry briefly.
  if (window.cn) {
    window.cn(name, props)
    return
  }
  let tries = 0
  const timer = window.setInterval(() => {
    tries += 1
    if (window.cn) {
      window.clearInterval(timer)
      window.cn(name, props)
    } else if (tries >= 20) {
      window.clearInterval(timer)
    }
  }, 250)
}
