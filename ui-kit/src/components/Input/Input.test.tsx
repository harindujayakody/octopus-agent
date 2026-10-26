import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Input from '.'
import { inputFrameClass } from './frame'
import Textarea from '../Textarea'

describe('Input', () => {
  it('a secret field turns off autofill, spellcheck, autocorrect and capitalisation', () => {
    render(<Input aria-label="Key" secret />)
    const el = screen.getByLabelText('Key')
    expect(el).toHaveAttribute('autocomplete', 'off')
    expect(el).toHaveAttribute('spellcheck', 'false')
    expect(el).toHaveAttribute('autocorrect', 'off')
    expect(el).toHaveAttribute('autocapitalize', 'off')
  })

  it('a plain field leaves them to the browser', () => {
    render(<Input aria-label="Name" />)
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('spellcheck')
  })

  // Owner feedback 5u: a field inside an overlay (Popover, Menu, Select
  // list, command palette panel, DialogModal) gets a smaller radius, and its
  // focus ring never extends past the field with an outer shadow. Audit
  // Phase B (ruling 7): every field's ring is the frame's outline
  // (focus-ring-within), 1 px past the frame (2 px under Increase
  // contrast's 3 px ring), never a box-shadow.
  // Audit Phase B (UI-07): every field is the control radius (8 px), so an
  // embedded field 4 px inside a 12 px overlay stays concentric.
  it('embedded renders the 8px control radius and no outer focus shadow', () => {
    render(<Input aria-label="Search" embedded />)
    const wrapper = screen.getByLabelText('Search').parentElement!
    expect(wrapper.className).toContain('rounded-control')
    expect(wrapper.className).toContain('focus-ring-within')
    expect(wrapper.className).not.toMatch(/shadow-\[var\(--ring-/)
  })

  it('the default (non-embedded) field is the control radius too, with its focus ring', () => {
    render(<Input aria-label="Name2" />)
    const wrapper = screen.getByLabelText('Name2').parentElement!
    expect(wrapper.className).toContain('rounded-control')
    expect(wrapper.className).toContain('focus-ring-within')
  })

  // Fix round 1 (M10): an embedded field in the error state had no focus
  // indication at all — the static `ring-error-base` doesn't change on
  // focus. It draws the field's ring, in the error color.
  it('embedded + error still shows a focus ring (on the error color)', () => {
    render(<Input aria-label="Proxy port" embedded error="Required" />)
    const wrapper = screen.getByLabelText('Proxy port').parentElement!
    expect(wrapper.className).toContain('focus-ring-within')
    expect(wrapper.className).toContain('[--focus-color:var(--error-base)]')
    expect(wrapper.className).not.toMatch(/shadow-\[var\(--ring-/)
  })
})

describe('Input semantics', () => {
  it('links its error and marks itself invalid; the icon is silent', () => {
    render(<Input label="Tag name" error="Another tag is called “Ads”" />)
    const input = screen.getByRole('textbox', { name: 'Tag name' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Another tag is called “Ads”')
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('links its hint and keeps a description the caller passed', () => {
    render(<><span id="own">Ports</span><Input label="Port" hint="1 to 65535" aria-describedby="own" /></>)
    expect(screen.getByRole('textbox', { name: 'Port' })).toHaveAccessibleDescription('Ports 1 to 65535')
  })

  it('does not autofill by default; technical fields are not spellchecked or corrected', () => {
    render(<><Input aria-label="Notes" /><Input aria-label="Host" technical /></>)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('autocomplete', 'off')
    const host = screen.getByRole('textbox', { name: 'Host' })
    expect(host).toHaveAttribute('spellcheck', 'false')
    expect(host).toHaveAttribute('autocorrect', 'off')
    expect(host).toHaveAttribute('autocapitalize', 'off')
    expect(host).toHaveAttribute('translate', 'no')
  })

  it('bare has no frame; inline is 28 px with a 1 px ring', () => {
    render(<><Input aria-label="Search" variant="bare" /><Input aria-label="Rename" density="inline" /></>)
    const frame = (name: string) => screen.getByRole('textbox', { name }).parentElement!.className
    expect(frame('Search')).not.toContain('ring-1')
    expect(frame('Search')).toContain('bg-transparent')
    // Forced colors: the bare frame, not its text box, draws the focus mark,
    // inside itself (merge point 1: the text box's crossed the panel edge).
    expect(frame('Search').split(' ')).toContain('forced-focus-within')
    expect(frame('Rename')).toContain('h-7')
    expect(frame('Rename')).not.toContain('focus-within:ring-2')
    // Phase B's field ring is 2 px from 1 px past the frame; inline it is
    // 1 px on the frame's own edge.
    expect(frame('Rename').split(' ')).toContain('[--focus-width:1px]')
  })

  it('an explicit prop still wins over the defaults', () => {
    render(<Input aria-label="Email" technical autoComplete="email" spellCheck />)
    const email = screen.getByRole('textbox', { name: 'Email' })
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(email).toHaveAttribute('spellcheck', 'true')
  })

  it('Textarea links its error too', () => {
    render(<Textarea label="Proxies" error="Line 3 has no port" />)
    const area = screen.getByRole('textbox', { name: 'Proxies' })
    expect(area).toHaveAttribute('aria-invalid', 'true')
    expect(area).toHaveAccessibleDescription('Line 3 has no port')
  })

  it('Textarea does not autofill, and technical text is left alone', () => {
    render(<Textarea aria-label="Arguments" technical />)
    const area = screen.getByRole('textbox', { name: 'Arguments' })
    expect(area).toHaveAttribute('autocomplete', 'off')
    expect(area).toHaveAttribute('spellcheck', 'false')
    expect(area).toHaveAttribute('translate', 'no')
  })
})

describe('inputFrameClass', () => {
  it('a wrapping token field grows from the field height and keeps the field look', () => {
    const cls = inputFrameClass({ size: 'xsmall', wrap: true }).split(' ')
    expect(cls).toContain('min-h-[30px]')
    expect(cls).toContain('flex-wrap')
    expect(cls).toContain('focus-ring-within')
    expect(cls.some((c) => /^h-/.test(c))).toBe(false)
  })

  it('a control that takes focus itself (a Select) rings on focus-visible, not focus-within', () => {
    const cls = inputFrameClass({ size: 'xsmall', focusSelf: true }).split(' ')
    expect(cls).toContain('focus-ring')
    expect(cls).not.toContain('focus-ring-within')
    expect(cls).toContain('h-[30px]')
  })
})
