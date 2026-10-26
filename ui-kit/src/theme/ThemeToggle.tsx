import { cn } from '@/lib/cn'
import { useTheme } from './ThemeProvider'
import type { Theme } from './ThemeProvider'

const options: { value: Theme; label: string; glyph: string }[] = [
  { value: 'light', label: 'Light', glyph: '☀' },
  { value: 'dark', label: 'Dark', glyph: '☾' },
  { value: 'system', label: 'System', glyph: '⌂' },
]

/** Small segmented control for switching the active theme. */
export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  return (
    <div className={cn('inline-flex items-center gap-[4px] rounded-control bg-bg-sunken p-[4px]', className)}>
      {options.map((o) => {
        const active = theme === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setTheme(o.value)}
            aria-pressed={active}
            title={o.label}
            className={cn(
              'inline-flex h-8 items-center gap-[6px] rounded-chip-sm px-[10px] text-ui focus-ring transition-hover aria-pressed:forced-selected',
              active
                ? 'bg-bg-raised text-text-strong-950 shadow-[var(--shadow-xs)]'
                : 'text-text-sub-600 hover:text-text-strong-950',
            )}
          >
            <span aria-hidden>{o.glyph}</span>
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
