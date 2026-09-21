import { Moon, Sun } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { toggleTheme } from '~/lib/theme'

// Both icons are always rendered and swapped with the `dark:` variant, so the
// server and client markup match regardless of the active theme (no hydration
// mismatch, no post-mount icon flip).
export function ThemeToggle() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={toggleTheme}>
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  )
}
