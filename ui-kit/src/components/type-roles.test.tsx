import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AlertModal from './AlertModal'
import Badge from './Badge'
import Button from './Button'
import DialogModal from './DialogModal'
import EmptyState from './EmptyState'
import Input from './Input'
import Label from './Label'
import Menu from './Menu'
import Modal from './Modal'
import Textarea from './Textarea'
import Tooltip from './Tooltip'

const classesOf = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? []

afterEach(() => vi.useRealTimers())

describe('type roles (audit Phase B, B3)', () => {
  it('controls read at the UI size; field labels are the field-label role', () => {
    render(
      <>
        <Button>Save</Button>
        <Input label="Name" />
        <Textarea label="Notes" maxLength={100} showCount defaultValue="abc" />
      </>,
    )
    expect(classesOf(screen.getByRole('button', { name: 'Save' }))).toContain('text-ui')
    const label = screen.getByText('Name')
    expect(label.tagName).toBe('LABEL')
    expect(classesOf(label)).toEqual(expect.arrayContaining(['text-field-label', 'text-text-sub-600']))
    expect(classesOf(screen.getByRole('textbox', { name: 'Name' }))).toContain('text-body')
    expect(classesOf(screen.getByText('3/100'))).toEqual(expect.arrayContaining(['text-secondary', 'tabular-nums']))
  })

  it('every dialog title is the panel-title role (UI-12, TYPE-10)', () => {
    const { unmount } = render(<Modal open onClose={() => {}} title="Palette" />)
    expect(classesOf(screen.getByText('Palette'))).toContain('text-panel-title')
    unmount()
    const second = render(<DialogModal open onClose={() => {}} title="New folder" />)
    expect(classesOf(screen.getByText('New folder'))).toContain('text-panel-title')
    second.unmount()
    render(<AlertModal open onClose={() => {}} title="Heads up" />)
    expect(classesOf(screen.getByText('Heads up'))).toContain('text-panel-title')
  })

  it('an empty state title is a section title; small chips are micro', () => {
    render(
      <>
        <EmptyState title="Nothing here" hint="Add one" />
        <Badge size="small">SOCKS5</Badge>
      </>,
    )
    expect(classesOf(screen.getByText('Nothing here'))).toContain('text-section-title')
    expect(classesOf(screen.getByText('Add one'))).toContain('text-body')
    expect(classesOf(screen.getByText('SOCKS5'))).toContain('text-micro')
  })

  it('menu group labels are sentence case; tooltips are secondary text', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const both = (open: boolean) => (
      <>
        <Menu open={open} onOpenChange={() => {}} anchor={{ current: document.body }} items={[{ type: 'label', label: 'Move to' }, { label: 'Ads', onSelect: () => {} }]} />
        <Tooltip content="Copy URL"><button>copy</button></Tooltip>
      </>
    )
    const { rerender } = render(both(true))
    const group = screen.getByText('Move to')
    expect(classesOf(group)).toContain('text-secondary')
    expect(group.getAttribute('class')).not.toMatch(/subheading|uppercase/)
    // No tooltip opens while a menu is open (merge point 5): close it first.
    rerender(both(false))
    fireEvent.pointerEnter(screen.getByText('copy').parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    expect(classesOf(screen.getByRole('tooltip'))).toContain('text-secondary')
  })

  it('Label renders a label, or a span that names a group', () => {
    render(
      <>
        <Label htmlFor="x">Port</Label>
        <input id="x" />
        <Label as="span" id="cap">Operating system</Label>
      </>,
    )
    expect(screen.getByLabelText('Port').id).toBe('x')
    const span = screen.getByText('Operating system')
    expect(span.tagName).toBe('SPAN')
    expect(span).not.toHaveAttribute('for')
    expect(classesOf(span)).toEqual(expect.arrayContaining(['text-field-label', 'text-text-sub-600']))
  })

  it('htmlFor belongs to a label only: a span or div that names a group cannot take it', () => {
    render(
      <>
        {/* @ts-expect-error htmlFor is a type error unless as is 'label' (check:kit's tsc proves it) */}
        <Label as="div" htmlFor="y">Proxy history</Label>
        <input id="y" />
      </>,
    )
    const div = screen.getByText('Proxy history')
    expect(div.tagName).toBe('DIV')
    expect(div).not.toHaveAttribute('for')
  })

  it('no kit component uses an old type class', () => {
    render(<><Button>a</Button><Input label="b" /><EmptyState title="c" /></>)
    expect(document.body.innerHTML).not.toMatch(/text-(label|paragraph|title|subheading)-/)
  })
})
