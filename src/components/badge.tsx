import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

export type BadgeVariant = 'neutral' | 'brand' | 'bad' | 'outline'

const variants: Record<BadgeVariant, string> = {
  neutral: 'bg-secondary text-secondary-foreground border-transparent',
  brand: 'bg-brand/10 text-brand border-brand/30',
  bad: 'bg-destructive/10 text-destructive border-destructive/30',
  outline: 'text-muted-foreground border-border',
}

// Hand-rolled (shadcn's badge pulls in radix Slot, which this template avoids).
export function Badge({
  variant = 'neutral',
  className,
  title,
  children,
}: {
  variant?: BadgeVariant
  className?: string
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        variants[variant],
        className
      )}>
      {children}
    </span>
  )
}
