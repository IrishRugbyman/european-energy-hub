import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props {
  label?: string
  children: React.ReactNode
  className?: string
}

export function MethodologyToggle({ label = 'Methodology', children, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`mt-3 ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {label}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs text-muted-foreground leading-relaxed">
          {children}
        </div>
      )}
    </div>
  )
}
