import { cn } from '@/lib/cn'

export type KbdProps = React.HTMLAttributes<HTMLElement> & {
  /** 'onTooltip': drawn in the tooltip's own text color. */
  tone?: 'default' | 'onTooltip'
}

/** A key cap: "⌘K", "Enter", "Esc", "S". Decorative next to a label that
 *  already declares the key with `aria-keyshortcuts`; pass `aria-hidden` there.
 *  18 px tall with 5 px sides: the app's key cap before it moved into the kit
 *  (owner: nothing grows). */
export default function Kbd({ tone = 'default', className, children, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        // A fill, no ring (borderless, owner 2026-10-01): one step past the weak fill.
        'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-chip px-[5px] font-sans text-micro tracking-normal tabular-nums',
        tone === 'onTooltip' ? 'bg-current/20 text-current' : 'bg-bg-active text-text-sub-600',
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  )
}
