import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Alert from './Alert'
import AlertModal from './AlertModal'
import Badge from './Badge'
import Button from './Button'
import Checkbox from './Checkbox'
import Chip from './Chip'
import DialogModal from './DialogModal'
import EmptyState from './EmptyState'
import Menu from './Menu'
import Modal from './Modal'
import NavItem from './NavItem'
import Popover from './Popover'
import ProgressBar from './ProgressBar'
import Radio from './Radio'
import SegmentControl from './SegmentControl'
import Select from './Select'
import Switch from './Switch'
import Tabs from './Tabs'
import Tooltip from './Tooltip'

// Every class in `want` is on `el`, none of `banned` is.
function roles(el: Element, want: string[], banned: string[] = []) {
  const classes = el.getAttribute('class')?.split(/\s+/) ?? []
  for (const c of want) expect(classes, `${c} missing from "${el.getAttribute('class')}"`).toContain(c)
  for (const c of banned) expect(classes, `${c} still on "${el.getAttribute('class')}"`).not.toContain(c)
}

afterEach(() => vi.useRealTimers())

describe('color roles (audit Phase B, B1)', () => {
  it('Button: a danger fill with a readable label, brand text, overlay hovers', () => {
    render(
      <>
        <Button variant="error">Delete</Button>
        <Button variant="primary" mode="lighter">Start</Button>
        <Button variant="neutral" mode="ghost">More</Button>
        <Button variant="primary" mode="link">Docs</Button>
      </>,
    )
    roles(screen.getByRole('button', { name: 'Delete' }), ['bg-error-fill', 'hover:bg-error-fill-hover'], ['hover:bg-red-600', 'bg-error-base'])
    roles(screen.getByRole('button', { name: 'Start' }), ['bg-primary-tint', 'text-primary-text', 'hover:bg-primary-tint-hover'], ['text-primary-base'])
    roles(screen.getByRole('button', { name: 'More' }), ['hover:bg-bg-hover'], ['hover:bg-bg-weak-50'])
    roles(screen.getByRole('button', { name: 'Docs' }), ['text-primary-text'])
  })

  it('Checkbox, Radio and Switch draw a 3:1 control edge', () => {
    render(
      <>
        <Checkbox aria-label="box" />
        <Radio aria-label="dot" />
        <Switch aria-label="toggle" />
      </>,
    )
    roles(screen.getByRole('checkbox', { name: 'box' }), ['ring-stroke-control'], ['ring-stroke-sub-300'])
    roles(screen.getByRole('radio', { name: 'dot' }), ['ring-stroke-control'], ['ring-stroke-sub-300'])
    roles(screen.getByRole('switch', { name: 'toggle' }), ['bg-stroke-control'], ['bg-bg-sub-300'])
  })

  it('Menu: a raised layer; its one highlight (pointer or keys) uses the overlay roles', () => {
    render(
      <Menu
        open
        onOpenChange={() => {}}
        anchor={{ current: document.body }}
        items={[
          { label: 'Rename', onSelect: () => {} },
          { label: 'Delete', onSelect: () => {}, danger: true },
        ]}
      />,
    )
    roles(screen.getByRole('menu'), ['bg-bg-popover'], ['bg-bg-white-0', 'bg-bg-raised'])
    // One highlight (audit Phase C, EMIL-06): the pointer moves focus, so the
    // focus fill is the only one; no hover fill of its own.
    // Active equals hover (owner, 2026-10-01): the highlighted item is the hover gray, pressed a step darker.
    roles(screen.getByRole('menuitem', { name: 'Rename' }), ['focus:bg-bg-hover', 'enabled:active:bg-bg-active'], ['focus:bg-bg-active'])
    roles(screen.getByRole('menuitem', { name: 'Delete' }), ['text-error-text', 'focus:bg-error-tint-menu'], ['enabled:hover:bg-error-tint', 'focus:bg-error-tint'])
  })

  it('Popover is a popover surface and the dialogs are raised; both float on a shadow, with no border (borderless)', () => {
    const { unmount } = render(
      <>
        <Popover open onOpenChange={() => {}} anchorPoint={{ x: 1, y: 1 }} aria-label="Panel"><p>x</p></Popover>
        <Modal open onClose={() => {}} title="Palette" />
      </>,
    )
    roles(screen.getByRole('dialog', { name: 'Panel' }), ['bg-bg-popover', 'shadow-(--shadow-float)'], ['ring-1', 'border', 'bg-bg-raised'])
    roles(screen.getByRole('dialog', { name: 'Palette' }), ['bg-bg-raised', 'shadow-(--shadow-float)'], ['bg-bg-white-0', 'border', 'border-stroke-soft-200'])
    unmount()
    render(<DialogModal open onClose={() => {}} title="Move" />)
    roles(screen.getByRole('dialog', { name: 'Move' }), ['bg-bg-raised'])
  })

  // UI-15: the status color is on the icon only; the surface stays raised.
  it('AlertModal colors its icon, not its surface, and never with raw hex', () => {
    render(<AlertModal open onClose={() => {}} title="Heads up" status="warning" />)
    roles(screen.getByRole('alertdialog'), ['bg-bg-raised'])
    expect(document.body.innerHTML).not.toMatch(/bg-\[#/)
    expect(document.body.innerHTML).toContain('text-warning-base')
    expect(document.body.innerHTML).not.toContain('bg-warning-tint')
  })

  it('Select: the list is a popover surface and the chosen value is marked in brand text', () => {
    render(<Select aria-label="Size" value="a" options={[{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Size' }))
    roles(screen.getByRole('listbox').parentElement!, ['bg-bg-popover'], ['bg-bg-raised'])
    // C18: the list's one highlight (keys and pointer) is the list-item fill.
    roles(screen.getByRole('option', { name: 'B' }), ['data-highlighted:bg-bg-hover', 'active:bg-bg-active'], ['enabled:hover:bg-bg-weak-50', 'data-highlighted:bg-bg-active'])
    expect(document.body.innerHTML).toContain('text-primary-text')
  })

  // The popover surface is a lighter step in dark, so a hint (soft gray) on
  // the highlighted row's fill would fall under 4.5:1: it takes the sub gray
  // while its row is the highlight (scripts/check-contrast.mjs measures soft
  // text on the resting popover only).
  it('Menu and Select hints step up to the sub gray while their row is highlighted', () => {
    const { unmount } = render(
      <Menu
        open
        onOpenChange={() => {}}
        anchor={{ current: document.body }}
        items={[{ label: 'Rename', hint: 'F2', onSelect: () => {} }]}
      />,
    )
    roles(screen.getByRole('menuitem', { name: /Rename/ }), ['group'])
    roles(screen.getByText('F2'), ['text-text-soft-400', 'group-focus:text-text-sub-600'])
    unmount()
    render(<Select aria-label="Size" value="a" options={[{ label: 'A', value: 'a' }, { label: 'B', value: 'b', hint: 'ok' }]} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Size' }))
    roles(screen.getByRole('option', { name: /B/ }), ['group'])
    roles(within(screen.getByRole('option', { name: /B/ })).getByText('ok'), ['text-text-soft-400', 'group-data-highlighted:text-text-sub-600'])
  })

  // A badge in an option row lies over the row's highlight: its text steps up
  // on the highlighted row (scripts/check-contrast.mjs measures those tokens).
  it('an option badge steps its text up while its row is highlighted', () => {
    render(
      <Select
        aria-label="Size"
        value="a"
        options={[
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b', badge: { label: 'Not encrypted', color: 'warning' } },
          { label: 'C', value: 'c', badge: { label: 'New' } },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Size' }))
    roles(screen.getByText('Not encrypted'), ['text-warning-text', 'group-data-highlighted:text-warning-text-on-highlight'])
    roles(screen.getByText('New'), ['text-text-sub-600', 'group-data-highlighted:text-text-strong-950'])
  })

  it('Tooltip is a dark raised bubble with a lit top edge in dark and no hairline, not a white slab in dark', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    render(<Tooltip content="Copy URL"><button>copy</button></Tooltip>)
    fireEvent.pointerEnter(screen.getByText('copy').parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    roles(screen.getByRole('tooltip'), ['bg-bg-tooltip', 'text-text-tooltip', 'shadow-(--shadow-tooltip)'], ['bg-bg-strong-950', 'text-text-white-0', 'ring-stroke-soft-200'])
  })

  it('NavItem: the current page is neutral (O3); a drop target keeps the accent', () => {
    render(
      <>
        <NavItem icon={<svg />} label="Profiles" active badge={3} />
        <NavItem icon={<svg />} label="Proxies" badge={5} />
        <NavItem icon={<svg />} label="Ads" dropActive />
        <NavItem icon={<svg />} label="Shops" active dropActive />
      </>,
    )
    // Active equals hover (owner, 2026-10-01): the current item is the hover gray; pressed, a step darker.
    roles(screen.getByRole('button', { name: /Profiles/ }), ['bg-bg-hover', 'not-aria-disabled:active:bg-bg-active', 'text-text-strong-950'], ['bg-bg-active', 'bg-primary-alpha-10', 'text-primary-base'])
    roles(screen.getByText('3'), ['text-text-sub-600'])
    roles(screen.getByText('5'), ['text-text-soft-400'])
    roles(screen.getByRole('button', { name: /Proxies/ }), ['hover:bg-bg-hover'])
    roles(screen.getByRole('button', { name: /Ads/ }), ['bg-primary-tint', 'text-primary-text'])
    // The current page as a drop target shows only the drop look: one fill.
    roles(screen.getByRole('button', { name: /Shops/ }), ['bg-primary-tint', 'text-primary-text'], ['bg-bg-active', 'text-text-strong-950'])
  })

  it('Tabs and SegmentControl: a sunken track and a raised pill; vertical tabs are neutral', () => {
    const items = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]
    render(
      <>
        <Tabs aria-label="pill" variant="pill" value="a" onChange={() => {}} items={items} />
        <Tabs aria-label="side" orientation="vertical" value="a" onChange={() => {}} items={items} />
        <SegmentControl aria-label="seg" value="a" onChange={() => {}} items={items} />
      </>,
    )
    // The tracks rest as a field does: the weak fill unless the surface
    // says otherwise (`--control-fill`: white on the page's ground in light).
    const track = 'bg-[var(--control-fill,var(--bg-weak-50))]'
    roles(screen.getByRole('tablist', { name: 'pill' }), [track], ['bg-bg-sunken'])
    roles(screen.getByRole('radiogroup', { name: 'seg' }), [track], ['bg-bg-sunken'])
    const [pillA, , sideA] = screen.getAllByRole('tab')
    const [segA] = screen.getAllByRole('radio')
    // The selected one: the raised layer, unless the surface says otherwise (a gray step in a white track).
    const on = 'bg-[var(--control-on,var(--bg-raised))]'
    roles(pillA, [on], ['bg-bg-white-0'])
    roles(segA, [on], ['bg-bg-white-0'])
    roles(sideA, ['bg-bg-hover', 'active:bg-bg-active', 'text-text-strong-950'], ['bg-bg-active', 'text-primary-base', 'bg-primary-alpha-10'])
  })

  it('Chip, Badge, EmptyState, Alert and ProgressBar', () => {
    render(
      <>
        <Chip selected>On</Chip>
        <Chip>Off</Chip>
        <Badge color="success">Connected</Badge>
        <Badge color="information">Info</Badge>
        <EmptyState icon={<svg data-testid="tile-icon" />} title="Nothing" />
        <Alert status="success" variant="light" title="Saved" />
        <ProgressBar value={40} color="gray" />
      </>,
    )
    roles(screen.getByRole('button', { name: 'On' }), ['bg-bg-selected', 'text-primary-text'])
    roles(screen.getByRole('button', { name: 'Off' }), ['control-fill', 'hover:bg-bg-active'], ['ring-1'])
    roles(screen.getByText('Connected'), ['bg-success-tint', 'text-success-text'])
    roles(screen.getByText('Info'), ['bg-information-tint', 'text-information-text'])
    roles(screen.getByTestId('tile-icon').parentElement!, ['bg-bg-weak-50', 'text-icon-sub-600'], ['bg-primary-alpha-10'])
    // A success is a polite status (Task 22, A11Y-05).
    roles(screen.getByRole('status'), ['bg-success-tint-hover', 'text-text-strong-950'])
    expect(document.body.innerHTML).not.toMatch(/\bdark:/)
    const bar = screen.getByRole('progressbar')
    roles(bar, ['bg-[var(--control-fill,var(--bg-sunken))]'])
    roles(bar.firstElementChild!, ['bg-stroke-control'], ['bg-neutral-400'])
  })

  // Owner (Task 14 fix round): a filled alert's fill and text are Alert tokens:
  // a solid state fill with white text in light, the state's tint with the
  // theme's text in dark (no solid block), with no `dark:` class.
  it('Alert: a filled alert reads its own fill and text tokens; a tinted one keeps sub text and a sub icon', () => {
    render(
      <>
        <Alert status="warning" variant="filled" title="Low balance" onClose={() => {}}>Top up soon</Alert>
        <Alert status="information" variant="lighter" title="Synced" onClose={() => {}}>All devices</Alert>
      </>,
    )
    // A warning and an information are polite statuses (Task 22, A11Y-05).
    const [filled, tinted] = screen.getAllByRole('status')
    roles(filled, ['bg-warning-alert', 'text-on-alert'], ['bg-warning-base', 'bg-warning-fill', 'text-static-white'])
    roles(screen.getByText('Top up soon'), ['text-on-alert'], ['text-static-white'])
    // Its icon: white in light, the state's text color in dark (the review of the fix round).
    roles(filled.firstElementChild!, ['text-warning-alert-icon'], ['text-on-alert'])
    roles(screen.getAllByRole('button', { name: 'Dismiss' })[0], ['text-on-alert-soft'], ['text-static-white/80'])
    roles(tinted, ['bg-information-tint', 'text-text-strong-950'])
    roles(screen.getByText('All devices'), ['text-text-sub-600'])
    // The soft icon is 2.5:1 on a dark tint-hover; the sub icon holds 3:1 on every tint.
    const [, dismiss] = screen.getAllByRole('button', { name: 'Dismiss' })
    roles(dismiss, ['text-icon-sub-600'], ['text-icon-soft-400', 'text-text-soft-400'])
    expect(document.body.innerHTML).not.toMatch(/\bdark:/)
  })
})
