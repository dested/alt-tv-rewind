import { initials, posterHue } from '~/lib/usenet'

// Monogram avatar in a per-poster hue (identity, not decoration — see ui.md).
// aria-hidden: the display name always sits next to it.
export function Avatar({ name, size = 36 }: { name: string; size?: 22 | 28 | 36 }) {
  const hue = posterHue(name)
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-sans font-semibold select-none"
      style={{
        width: size,
        height: size,
        fontSize: size === 36 ? 13 : size === 28 ? 11 : 9,
        background: `oklch(var(--avatar-l) 0.06 ${hue})`,
        color: `oklch(var(--avatar-fg-l) 0.09 ${hue})`,
      }}>
      {initials(name)}
    </span>
  )
}
