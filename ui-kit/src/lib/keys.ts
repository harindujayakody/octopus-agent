const NAMES: Record<string, string> = {
  '⌘': 'Meta', Cmd: 'Meta', Meta: 'Meta',
  '⌃': 'Control', Ctrl: 'Control', Control: 'Control',
  '⌥': 'Alt', Alt: 'Alt', Option: 'Alt',
  '⇧': 'Shift', Shift: 'Shift',
  '⌫': 'Backspace', Backspace: 'Backspace',
  '⌦': 'Delete', Del: 'Delete', Delete: 'Delete',
  '↵': 'Enter', Enter: 'Enter', Esc: 'Escape', Escape: 'Escape',
  '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', Space: 'Space', Tab: 'Tab',
}

/** The `aria-keyshortcuts` value for a key as the app prints it: "⌘K" is
 *  "Meta+K", "Ctrl+Shift+Z" is "Control+Shift+Z", "⌫" is "Backspace". */
export function toAriaKeyShortcuts(shortcut: string): string {
  const parts = shortcut.includes('+') && shortcut.length > 1
    ? shortcut.split('+')
    : [...shortcut.matchAll(/[⌘⌃⌥⇧]|[^⌘⌃⌥⇧]+/g)].map((m) => m[0])
  return parts.map((p) => NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+')
}

/** The letter a key means: the Latin letter printed on it, else its place
 *  (`e.code` "KeyS"), so a Cyrillic or Greek layout still presses S (A11Y-02).
 *  The one copy; the app's key registry uses it too. */
export function letterOf(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase()
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  return null
}

/** The digit a key means, by its place: AZERTY types "&" on the 1 key without
 *  Shift, and Mod+1 must still be 1 (PC-044). */
export function digitOf(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5)
  if (/^Numpad[0-9]$/.test(e.code)) return e.code.slice(6)
  if (/^[0-9]$/.test(e.key)) return e.key
  return null
}

/** Whether a key event is one of the shortcuts in an `aria-keyshortcuts`
 *  value ("S", "Meta+K", "Delete Backspace"). Modifiers match exactly; a
 *  letter by the letter on the key, else its place; a digit by its place;
 *  punctuation by the character typed, whatever Shift it took. */
export function matchesAriaKeyShortcuts(e: KeyboardEvent, value: string): boolean {
  return value.split(/\s+/).filter(Boolean).some((shortcut) => {
    const parts = shortcut.split('+')
    const key = parts.pop() ?? ''
    if (e.metaKey !== parts.includes('Meta') || e.ctrlKey !== parts.includes('Control') || e.altKey !== parts.includes('Alt')) return false
    const shift = parts.includes('Shift')
    if (/^[a-z]$/i.test(key)) return e.shiftKey === shift && letterOf(e) === key.toUpperCase()
    if (/^[0-9]$/.test(key)) return digitOf(e) === key
    if (key.length === 1) return e.key === key
    if (e.shiftKey !== shift) return false
    return key === 'Space' ? e.key === ' ' : e.key === key
  })
}
