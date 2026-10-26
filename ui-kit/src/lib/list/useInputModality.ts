import { useEffect } from 'react'

/// How the person last drove the page, on `<html>` as `data-input`:
/// "pointer" once the pointer moves or presses, "keys" once a key drives
/// something. A list draws its target row (its active row) from it (the
/// `row-target` variant, tokens.css): while the keys drive, the target is
/// drawn wherever it is; while the pointer drives, only while the pointer is
/// on it (owner bug, 2026-10-01: "when mouse not hovering anymore it stuck
/// like its hovering"). The keys still act on it either way.
///
/// Not every key counts: typing or moving the caret in a field, and a modifier held for a click
/// (Shift+click, Cmd+click), leave the pointer driving. A pointer event at
/// the last place is not a move (a list scrolling under a still pointer
/// sends those), and one a script sends (a tooltip passing a press through
/// to what lies under it) is not the person's.
export function useInputModality(): void {
  useEffect(() => {
    if (users++ === 0) stop = start()
    return () => {
      if (--users === 0) {
        stop?.()
        stop = null
      }
    }
  }, [])
}

let users = 0
let stop: (() => void) | null = null

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'])
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"])'

/// In a field, a key that types or moves the caret is the field's; Tab,
/// Escape and Enter leave it or act on the page, so the keys drive.
function edits(e: KeyboardEvent): boolean {
  if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'Enter') return false
  if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') return true
  return e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown'
}

function start(): () => void {
  const root = document.documentElement
  let x = Number.NaN
  let y = Number.NaN
  const set = (input: 'pointer' | 'keys') => {
    if (root.dataset.input !== input) root.dataset.input = input
  }
  const onKey = (e: KeyboardEvent) => {
    if (!e.isTrusted || MODIFIERS.has(e.key) || e.isComposing) return
    if (e.target instanceof Element && e.target.closest(TYPING) && edits(e)) return
    set('keys')
  }
  const onPointer = (e: PointerEvent) => {
    if (!e.isTrusted || (e.type === 'pointermove' && e.clientX === x && e.clientY === y)) return
    x = e.clientX
    y = e.clientY
    set('pointer')
  }
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
  document.addEventListener('pointermove', onPointer, { capture: true, passive: true })
  return () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onPointer, true)
    document.removeEventListener('pointermove', onPointer, true)
  }
}
