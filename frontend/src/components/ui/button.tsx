import * as React from 'react'
import { cn } from '@/lib/utils'

const VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-border bg-transparent hover:bg-accent hover:text-foreground',
  ghost: 'hover:bg-accent hover:text-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
} as const

const SIZES = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-8',
  icon: 'h-9 w-9',
} as const

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
