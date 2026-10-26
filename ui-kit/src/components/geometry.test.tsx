import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CheckIcon, ICON_STROKE } from '@/lib/icons'
import AlertModal from './AlertModal'
import Badge from './Badge'
import Button from './Button'
import Card from './Card'
import DialogModal from './DialogModal'
import EmptyState from './EmptyState'
import Input from './Input'
import Menu from './Menu'
import Modal from './Modal'
import NavItem from './NavItem'
import Radio from './Radio'
import SegmentControl from './SegmentControl'
import Select from './Select'
import Tabs from './Tabs'
import Tooltip from './Tooltip'

const classesOf = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? []

describe('whole-pixel geometry (audit Phase B, B4)', () => {
  // Owner (Task 14 fix round): nothing larger than before the 4 px grid, on
  // whole pixels: xsmall fields 30, a SegmentControl's xsmall tab 24 in a
  // 3 px track (30).
  it('the smallest control steps exist, on whole pixels', () => {
    const items = [{ label: 'A', value: 'a' }]
    render(
      <>
        <Button size="3xsmall">Tiny</Button>
        <Input aria-label="Filter" inputSize="xsmall" />
        <Select aria-label="Size" size="xsmall" value="a" options={items} />
        <SegmentControl aria-label="seg" size="xsmall" value="a" onChange={() => {}} items={items} />
        <NavItem icon={<svg />} label="Profiles" size="small" />
      </>,
    )
    expect(classesOf(screen.getByRole('button', { name: 'Tiny' }))).toEqual(expect.arrayContaining(['h-6', 'rounded-control']))
    expect(classesOf(screen.getByRole('textbox', { name: 'Filter' }).parentElement!)).toEqual(expect.arrayContaining(['h-[30px]', 'rounded-control']))
    expect(classesOf(screen.getByRole('combobox', { name: 'Size' }))).toEqual(expect.arrayContaining(['h-[30px]', 'rounded-control']))
    expect(classesOf(screen.getByRole('radio', { name: 'A' }))).toContain('h-6')
    expect(classesOf(screen.getByRole('radiogroup', { name: 'seg' }))).toContain('p-[3px]')
    expect(classesOf(screen.getByRole('button', { name: 'Profiles' }))).toEqual(expect.arrayContaining(['h-7', 'rounded-control']))
  })

  it('cards, surfaces and dialogs use the radius roles; a menu nests its items (12 = 8 + 4)', () => {
    render(
      <>
        <Card data-testid="card" padding="md" />
        <Menu open onOpenChange={() => {}} anchor={{ current: document.body }} items={[{ label: 'Rename', onSelect: () => {} }]} />
      </>,
    )
    // A card is a tile (borderless, owner 2026-10-01): `tile` carries the tile radius.
    expect(classesOf(screen.getByTestId('card'))).toEqual(expect.arrayContaining(['tile', 'px-inset-side', 'py-inset']))
    expect(classesOf(screen.getByRole('menu'))).toEqual(expect.arrayContaining(['rounded-surface', 'p-[4px]']))
    expect(classesOf(screen.getByRole('menuitem', { name: 'Rename' }))).toContain('rounded-control')
  })

  // LAYOUT-03, then the owner (Task 14 fix round): nothing larger than before
  // the grid. One shell (UI-13): header, body and footer share the 14 px
  // side inset (the header's "14 px in"), so the title lines up with the
  // body; 14 above the header and under the footer's buttons. The body
  // draws its own top and bottom; with no rule over the footer (borderless,
  // owner 2026-10-01) the footer starts 2 px under a padded body.
  it('a dialog is the dialog radius; its header, body and footer insets are never larger than before the grid', () => {
    render(<DialogModal open onClose={() => {}} title="Move" onConfirm={() => {}} confirmLabel="Move"><p>body</p></DialogModal>)
    const panel = screen.getByRole('dialog', { name: 'Move' })
    expect(classesOf(panel)).toContain('rounded-dialog')
    const [header, form] = Array.from(panel.children)
    const [body, footer] = Array.from(form.children)
    expect(classesOf(header)).toEqual(expect.arrayContaining(['px-inset-dialog', 'pt-inset-bar']))
    expect(classesOf(body)).toContain('px-inset-dialog')
    expect(classesOf(footer)).toEqual(expect.arrayContaining(['px-inset-dialog', 'pt-[2px]', 'pb-inset-bar']))
    expect(classesOf(footer)).not.toContain('border-t')
  })

  // The icon circle holds 35 (its size before the grid) with the status
  // color on the 14 px icon only (UI-15); a Modal footer has the side inset
  // its header and body use, not the 14 px bar inset on all four sides.
  it('an AlertModal icon circle is 35 px (the dialog-icon role), a fill with no ring; a Modal footer is 14 px in at the sides, 2 under a padded body and 14 at the bottom', () => {
    render(
      <>
        <AlertModal open onClose={() => {}} status="error" title="Delete it?" />
        <Modal open onClose={() => {}} title="Sheet" footer={<button type="button">Done</button>}>body</Modal>
      </>,
    )
    const badge = screen.getByRole('alertdialog', { name: 'Delete it?' }).querySelector('.size-dialog-icon')
    expect(badge).not.toBeNull()
    expect(classesOf(badge!)).toEqual(expect.arrayContaining(['size-dialog-icon', 'rounded-full', 'bg-bg-weak-50']))
    expect(classesOf(badge!)).not.toContain('border')
    expect(badge!.querySelector('.text-error-base')).not.toBeNull()
    const footer = screen.getByRole('button', { name: 'Done' }).parentElement!
    expect(classesOf(footer)).toEqual(expect.arrayContaining(['px-inset-dialog', 'pt-[2px]', 'pb-inset-bar']))
    expect(classesOf(footer)).not.toContain('p-inset-bar')
  })

  // The parts the launcher does not draw, so e2e/density.spec.ts cannot measure them.
  it('Radio is 17 px with a 7 px dot; a Tabs pill is 28 in a 3 px track (owner, Task 14 fix round)', () => {
    const { container } = render(
      <>
        <Radio aria-label="One" name="r" />
        <Tabs variant="pill" aria-label="Panels" value="a" onChange={() => {}} items={[{ label: 'A', value: 'a' }]} />
      </>,
    )
    expect(classesOf(screen.getByRole('radio', { name: 'One' }))).toContain('size-[17px]')
    expect(classesOf(container.querySelector('input[type=radio] + span')!)).toContain('size-[7px]')
    expect(classesOf(screen.getByRole('tablist', { name: 'Panels' }))).toContain('p-[3px]')
    expect(classesOf(screen.getByRole('tab', { name: 'A' }))).toContain('h-7')
  })

  // Owner (Phase B fix round 2): the menu separator, badge, tooltip and the
  // Button 2xsmall / link spacing hold their pre-grid size (3.5 x n, floored).
  it('a menu separator, badge, tooltip and Button 2xsmall / link spacing are never larger than before the grid', () => {
    render(
      <>
        <Menu open onOpenChange={() => {}} anchor={{ current: document.body }} items={[{ label: 'A', onSelect: () => {} }, { type: 'separator' }, { label: 'B', onSelect: () => {} }]} />
        <Badge size="small">Small</Badge>
        <Badge size="medium">Medium</Badge>
        <Button size="2xsmall">Tiny</Button>
        <Button size="2xsmall" onlyIcon aria-label="Icon only"><svg /></Button>
        <Badge dot>Dotted</Badge>
        <Button mode="link">Link</Button>
      </>,
    )
    expect(classesOf(screen.getByRole('separator'))).toContain('my-[3px]')
    expect(classesOf(screen.getByText('Small'))).toEqual(expect.arrayContaining(['gap-[3px]', 'px-[5px]', 'py-[1px]']))
    expect(classesOf(screen.getByText('Medium'))).toEqual(expect.arrayContaining(['gap-[3px]', 'px-[7px]', 'py-[1px]']))
    expect(classesOf(screen.getByRole('button', { name: 'Tiny' }))).toEqual(expect.arrayContaining(['h-[24px]', 'px-[3px]']))
    expect(classesOf(screen.getByRole('button', { name: 'Link' }))).toContain('gap-[3px]')
    expect(classesOf(screen.getByRole('button', { name: 'Icon only' }))).toEqual(expect.arrayContaining(['h-[24px]', 'w-[24px]']))
    expect(classesOf(screen.getByText('Dotted').querySelector('span')!)).toContain('size-[5px]')
  })

  it('a tooltip is 7 px by 3 px in (as px-2 py-1 was before the grid)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    try {
      render(<Tooltip content="Tip"><button type="button">tip</button></Tooltip>)
      act(() => { vi.advanceTimersByTime(1000) })
      // Focus from Tab shows it; focus moved by code does not (C14).
      fireEvent.keyDown(document.body, { key: 'Tab' })
      act(() => screen.getByRole('button', { name: 'tip' }).focus())
      expect(classesOf(screen.getByRole('tooltip'))).toEqual(expect.arrayContaining(['px-[7px]', 'py-[3px]']))
    } finally {
      vi.useRealTimers()
    }
  })

  // Owner (Phase B fix round 3): empty screens want a readable icon, 21 px
  // (size-6 at the 14 px root before Phase B) in the 48 px tile.
  it('an EmptyState draws its icon at 21 px in a 48 px tile', () => {
    render(<EmptyState icon={<svg data-testid="ico" />} title="Nothing" />)
    const tile = screen.getByTestId('ico').parentElement!
    expect(classesOf(tile)).toEqual(expect.arrayContaining(['size-12', '[&>svg]:size-[21px]']))
  })

  it('kit icons draw the app stroke (UI-08)', () => {
    const { container } = render(<CheckIcon className="size-4" />)
    expect(ICON_STROKE).toBe(1.8)
    expect(container.querySelector('[stroke-width]')?.getAttribute('stroke-width')).toBe('1.8')
  })
})
