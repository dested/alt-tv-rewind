// Client-only theme state. The inline script in index.html applies the same
// logic before first paint; this module owns changes after hydration.
export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'theme'

const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#0a0a0a' }

const mediaQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function systemTheme(): Theme {
  return mediaQuery().matches ? 'dark' : 'light'
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // storage unavailable (private mode / blocked) — still apply for this page
  }
  applyTheme(theme)
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark')
}

// Track OS theme changes while the user has not picked a theme explicitly.
export function followSystemTheme(): () => void {
  const mq = mediaQuery()
  const onChange = () => {
    if (storedTheme() === null) applyTheme(systemTheme())
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
