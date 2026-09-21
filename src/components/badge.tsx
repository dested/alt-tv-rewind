import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

export type BadgeVariant = 'neutral' | 'brand' | 'bad' | 'outline'

const variants: Record<BadgeVariant, string> = {
  neutral: 'bg-secondary text-foreground',
  brand: 'bg-brand/12 text-brand',
  bad: 'bg-destructive/12 text-destructive',
  outline: 'border text-muted-foreground',
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
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        variants[variant],
        className
      )}>
      {children}
    </span>
  )
}
