import * as React from 'react'
import { cn } from '@/lib/utils'

// Minimal controlled/uncontrolled tab set with the same shape as the shadcn/Radix API the
// pricing page was written against, but no Radix dependency. The inactive panels are not
// rendered (the same "conditional rendering, not CSS hiding" rule the other pages follow, so
// recharts never measures a zero-size container).

interface TabsCtx {
  value: string
  setValue: (v: string) => void
  baseId: string
}
const Ctx = React.createContext<TabsCtx | null>(null)

function useTabs(): TabsCtx {
  const c = React.useContext(Ctx)
  if (!c) throw new Error('Tabs components must be used inside <Tabs>')
  return c
}

export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  className,
  children,
}: {
  defaultValue?: string
  value?: string
  onValueChange?: (v: string) => void
  className?: string
  children: React.ReactNode
}) {
  const [inner, setInner] = React.useState(defaultValue ?? '')
  const baseId = React.useId()
  const value = controlled ?? inner
  const setValue = (v: string) => {
    if (controlled === undefined) setInner(v)
    onValueChange?.(v)
  }
  return (
    <Ctx.Provider value={{ value, setValue, baseId }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  )
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  // Arrow keys / Home / End move focus and selection across the triggers.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tabs = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    const i = tabs.findIndex((t) => t === document.activeElement)
    if (i < 0) return
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next >= 0) {
      e.preventDefault()
      tabs[next].focus()
      tabs[next].click()
    }
  }
  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string
  className?: string
  children: React.ReactNode
}) {
  const { value: active, setValue, baseId } = useTabs()
  const selected = active === value
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected
          ? 'bg-background text-foreground shadow'
          : 'hover:text-foreground hover:bg-secondary/60',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string
  className?: string
  children: React.ReactNode
}) {
  const { value: active, baseId } = useTabs()
  if (active !== value) return null
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={cn('mt-2', className)}
    >
      {children}
    </div>
  )
}
