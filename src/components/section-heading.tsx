import type { ReactNode } from 'react'

// The signature device of the listing pages: a heavy 1.5px ink rule above every
// section heading (ui.md "Section heading").
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="border-rule border-t-[1.5px] pt-3 font-serif text-2xl font-semibold tracking-tight">
      {children}
    </h2>
  )
}
