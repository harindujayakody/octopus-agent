import { describe, expect, it } from 'vitest'
import { matchesAriaKeyShortcuts, toAriaKeyShortcuts } from './keys'

describe('toAriaKeyShortcuts', () => {
  it('reads the keys the app prints', () => {
    expect(toAriaKeyShortcuts('S')).toBe('S')
    expect(toAriaKeyShortcuts('⌘K')).toBe('Meta+K')
    expect(toAriaKeyShortcuts('⌘⇧K')).toBe('Meta+Shift+K')
    expect(toAriaKeyShortcuts('Ctrl+K')).toBe('Control+K')
    expect(toAriaKeyShortcuts('Ctrl+Shift+Z')).toBe('Control+Shift+Z')
    expect(toAriaKeyShortcuts('⌫')).toBe('Backspace')
    expect(toAriaKeyShortcuts('Del')).toBe('Delete')
    expect(toAriaKeyShortcuts('Esc')).toBe('Escape')
    expect(toAriaKeyShortcuts('?')).toBe('?')
  })
})

describe('matchesAriaKeyShortcuts', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)
  it('matches a letter by the Latin letter on the key, else its place', () => {
    expect(matchesAriaKeyShortcuts(key({ key: 's', code: 'KeyS' }), 'S')).toBe(true)
    // Caps Lock, and a Cyrillic layout (A11Y-02).
    expect(matchesAriaKeyShortcuts(key({ key: 'S', code: 'KeyS' }), 'S')).toBe(true)
    expect(matchesAriaKeyShortcuts(key({ key: 'ы', code: 'KeyS' }), 'S')).toBe(true)
    // AZERTY: the key printed A is A, whatever its place.
    expect(matchesAriaKeyShortcuts(key({ key: 'a', code: 'KeyQ' }), 'Q')).toBe(false)
    // Modifiers must match exactly.
    expect(matchesAriaKeyShortcuts(key({ key: 's', code: 'KeyS', metaKey: true }), 'S')).toBe(false)
    expect(matchesAriaKeyShortcuts(key({ key: 'S', code: 'KeyS', shiftKey: true }), 'S')).toBe(false)
    expect(matchesAriaKeyShortcuts(key({ key: 'k', code: 'KeyK', metaKey: true }), 'Meta+K')).toBe(true)
  })
  it('matches any of several shortcuts, and named keys', () => {
    expect(matchesAriaKeyShortcuts(key({ key: 'Backspace', code: 'Backspace' }), 'Delete Backspace')).toBe(true)
    expect(matchesAriaKeyShortcuts(key({ key: 'Delete', code: 'Delete' }), 'Delete Backspace')).toBe(true)
    expect(matchesAriaKeyShortcuts(key({ key: 'Enter', code: 'Enter' }), 'Delete Backspace')).toBe(false)
    expect(matchesAriaKeyShortcuts(key({ key: ' ', code: 'Space' }), 'Space')).toBe(true)
    expect(matchesAriaKeyShortcuts(key({ key: '?', code: 'Slash', shiftKey: true }), '?')).toBe(true)
  })
})
