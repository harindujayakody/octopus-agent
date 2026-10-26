import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Button from './Button'
import Checkbox from './Checkbox'
import Chip from './Chip'
import Input from './Input'
import NavItem from './NavItem'
import Radio from './Radio'
import SegmentControl from './SegmentControl'
import Select from './Select'
import Switch from './Switch'
import Tabs from './Tabs'
import Textarea from './Textarea'

const classesOf = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? []

describe('focus ring (audit Phase B, B2, ruling 7)', () => {
  it('every focusable control draws focus-ring, never a shadow ring or outline-none', () => {
    const items = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]
    render(
      <>
        <Button>Save</Button>
        <Checkbox aria-label="box" />
        <Radio aria-label="dot" />
        <Switch aria-label="toggle" />
        <NavItem icon={<svg />} label="Profiles" />
        <Chip>Tag</Chip>
        <Tabs aria-label="tabs" value="a" onChange={() => {}} items={items} />
        <SegmentControl aria-label="seg" value="a" onChange={() => {}} items={items} />
        <Select aria-label="Size" value="a" options={items} />
      </>,
    )
    const focusables = [
      screen.getByRole('button', { name: 'Save' }),
      screen.getByRole('checkbox', { name: 'box' }),
      screen.getByRole('radio', { name: 'dot' }),
      screen.getByRole('switch', { name: 'toggle' }),
      screen.getByRole('button', { name: 'Profiles' }),
      screen.getByRole('button', { name: 'Tag' }),
      ...screen.getAllByRole('tab'),
      ...within(screen.getByRole('radiogroup', { name: 'seg' })).getAllByRole('radio'),
      screen.getByRole('combobox', { name: 'Size' }),
    ]
    for (const el of focusables) {
      expect(classesOf(el), el.outerHTML.slice(0, 80)).toContain('focus-ring')
      expect(classesOf(el)).not.toContain('outline-none')
    }
    expect(document.body.innerHTML).not.toContain('--ring-')
  })

  it('a field draws the ring on its wrapper; a field in error recolors it', () => {
    render(
      <>
        <Input aria-label="Name" />
        <Input aria-label="Port" error="Use 1 to 65535" />
      </>,
    )
    const ok = screen.getByRole('textbox', { name: 'Name' })
    const bad = screen.getByRole('textbox', { name: 'Port' })
    expect(classesOf(ok)).toContain('outline-hidden')
    expect(classesOf(ok.parentElement!)).toContain('focus-ring-within')
    expect(classesOf(bad.parentElement!)).toContain('[--focus-color:var(--error-base)]')
  })

  // The text box is outline-hidden, which Tailwind turns into a painted 2 px
  // outline in forced colors; only the frame's focus-ring-within hides it. A
  // disabled field keeps that class (it can't take focus anyway), or it wears
  // a ring at rest in Windows contrast themes.
  it('a disabled field keeps the frame class that hides its text box outline', () => {
    render(
      <>
        <Input aria-label="Host" disabled />
        <Textarea aria-label="Notes" disabled />
      </>,
    )
    for (const box of [screen.getByRole('textbox', { name: 'Host' }), screen.getByRole('textbox', { name: 'Notes' })]) {
      expect(classesOf(box)).toContain('outline-hidden')
      expect(classesOf(box.parentElement!), box.tagName).toContain('focus-ring-within')
    }
  })
})
