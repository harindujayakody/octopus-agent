import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Menu, { type MenuItem } from '.'
import { useContextMenu } from './useContextMenu'

const items = (spy: (s: string) => void): MenuItem[] => [
  { label: 'Rename', onSelect: () => spy('rename') },
  { label: 'Duplicate', onSelect: () => spy('duplicate'), disabled: true },
  { type: 'separator' },
  { label: 'Delete', onSelect: () => spy('delete'), danger: true },
]

function Harness({ spy }: { spy: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchor} onClick={() => setOpen(true)}>more</button>
      <Menu open={open} onOpenChange={setOpen} anchor={anchor} items={items(spy)} aria-label="Profile actions" />
    </>
  )
}

/** Opens a menu from the keys (Enter on its button): its first item has the keyboard. */
const openByKeys = (trigger: HTMLElement) => {
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(trigger)
}
/** Opens a menu with the pointer: nothing is highlighted yet (Pair 30 ruling). */
const openByPointer = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
}

describe('Menu', () => {
  it('opened from the keys, focuses the first enabled item; the arrows reach disabled items too', async () => {
    render(<Harness spy={() => {}} />)
    openByKeys(screen.getByText('more'))
    const menu = screen.getByRole('menu', { name: 'Profile actions' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus())
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
  })

  it('runs the chosen item, closes and returns focus to the trigger', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    const trigger = screen.getByText('more')
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(spy).toHaveBeenCalledWith('delete')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('jumps to an item by its first letter', async () => {
    render(<Harness spy={() => {}} />)
    openByKeys(screen.getByText('more'))
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus())
    // A disabled item is reachable (ruling 3), so the first "d" lands on it;
    // the next one moves on to the following match.
    fireEvent.keyDown(menu, { key: 'd' })
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'd' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
  })
})

describe('Menu heading', () => {
  it('shows a heading above the items without taking focus', async () => {
    function WithHeading() {
      const anchor = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={anchor}>t</button>
          <Menu open onOpenChange={() => {}} anchor={anchor} heading='"Buy now" button' items={items(() => {})} />
        </>
      )
    }
    fireEvent.keyDown(document.body, { key: 'Enter' })
    render(<WithHeading />)
    expect(screen.getByText('"Buy now" button')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus())
  })

  function Headed({ heading, truncate }: { heading: string; truncate?: 'end' | 'middle' }) {
    const anchor = useRef<HTMLButtonElement>(null)
    return (
      <>
        <button ref={anchor}>t</button>
        <Menu open onOpenChange={() => {}} anchor={anchor} heading={heading} headingTruncate={truncate} items={items(() => {})} />
      </>
    )
  }
  const headingOf = () => screen.getByRole('menu').querySelector<HTMLElement>('[role="presentation"]')!

  it('is at most 320 px wide: a long heading is cut, it never widens the menu', () => {
    render(<Headed heading={'https://example.com/' + 'a-long-path/'.repeat(30)} />)
    expect(screen.getByRole('menu').className).toContain('max-w-[320px]')
    expect(headingOf().className).toContain('truncate')
  })

  it('cuts a heading in the middle, keeps its end, and reads whole', () => {
    const heading = 'https://example.com/' + 'a-long-path/'.repeat(10) + 'final-page-name'
    render(<Headed heading={heading} truncate="middle" />)
    const [start, end, ...rest] = [...headingOf().children]
    expect(rest).toHaveLength(0)
    expect(end.textContent).toBe('inal-page-name')
    expect(start.className).toContain('text-ellipsis')
    expect(headingOf().textContent).toBe(heading)
    expect(screen.getByRole('menu')).toHaveAttribute('aria-label', heading)
  })

  it('keeps a space at the split between the two pieces', () => {
    // The 15th character from the end is a space: it ends the first piece.
    const tail = 'dashboard-page'
    const heading = 'ProxyShard Smart Proxy Manager, the long name of an extension ' + tail
    expect(heading.at(-15)).toBe(' ')
    render(<Headed heading={heading} truncate="middle" />)
    const [start, end] = [...headingOf().children]
    expect(start.textContent?.endsWith(' ')).toBe(true)
    expect(end.textContent).toBe(tail)
    // Not `truncate` (nowrap drops a space at the end of a line): `pre` keeps it.
    expect(start.className).toContain('whitespace-pre')
    expect(start.className.split(/\s+/)).not.toContain('truncate')
    expect(headingOf().textContent).toBe(heading)
  })
})

describe('Menu group labels', () => {
  it('shows group labels that the arrow keys skip', async () => {
    function Grouped() {
      const anchor = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={anchor}>t</button>
          <Menu
            open
            onOpenChange={() => {}}
            anchor={anchor}
            items={[
              { type: 'label', label: 'Add step' },
              { label: 'Block', onSelect: () => {} },
              { type: 'separator' },
              { type: 'label', label: 'Mount live' },
              { label: 'Modify', onSelect: () => {} },
            ]}
          />
        </>
      )
    }
    fireEvent.keyDown(document.body, { key: 'Enter' })
    render(<Grouped />)
    expect(screen.getByText('Add step')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Block' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Modify' })).toHaveFocus()
  })
})

describe('useContextMenu', () => {
  function Row({ spy }: { spy: (s: string) => void }) {
    const menu = useContextMenu()
    return (
      <>
        <div onContextMenu={(e) => menu.open(e, items(spy))}>row</div>
        {menu.node}
      </>
    )
  }

  it('opens at the pointer on right-click and closes on Escape', async () => {
    render(<Row spy={() => {}} />)
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 40, clientY: 50 })
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('can show a heading', async () => {
    function Headed() {
      const menu = useContextMenu()
      return (
        <>
          <div onContextMenu={(e) => menu.open(e, items(() => {}), { heading: 'https://example.com/api' })}>row</div>
          {menu.node}
        </>
      )
    }
    render(<Headed />)
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 10, clientY: 10 })
    expect(await screen.findByText('https://example.com/api')).toBeInTheDocument()
  })
})

describe('Menu enter and exit', () => {
  it('ignores a click on an item while it leaves: it is inert', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    openByKeys(screen.getByText('more'))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    const menu = screen.getByRole('menu', { hidden: true })
    expect(menu).toHaveAttribute('data-ending-style')
    expect(menu).toHaveAttribute('inert')
  })

  it('leaves at once when an item runs, and opens again afterwards', async () => {
    render(<Harness spy={() => {}} />)
    fireEvent.click(screen.getByText('more'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    fireEvent.click(screen.getByText('more'))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('grows from its trigger corner', async () => {
    render(<Harness spy={() => {}} />)
    fireEvent.click(screen.getByText('more'))
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu.style.transformOrigin).toBe('top left'))
  })
})

describe('Menu and a double click', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
  afterEach(() => vi.useRealTimers())

  it('the second click of a double click on an item reaches nothing under it', () => {
    const under = vi.fn()
    render(<><div data-testid="under" onClick={under} /><Harness spy={() => {}} /></>)
    fireEvent.click(screen.getByText('more'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }), { detail: 1 })
    fireEvent.click(screen.getByTestId('under'), { detail: 2 })
    expect(under).not.toHaveBeenCalled()
    // A new single click is a new choice.
    fireEvent.click(screen.getByTestId('under'), { detail: 1 })
    expect(under).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.click(screen.getByTestId('under'), { detail: 2 })
    expect(under).toHaveBeenCalledTimes(2)
  })

  it('the second press reaches no pointer listener either, near the first click only', () => {
    const pressed = vi.fn()
    render(<><div data-testid="under" onPointerDown={pressed} /><Harness spy={() => {}} /></>)
    fireEvent.click(screen.getByText('more'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }), { detail: 1, clientX: 40, clientY: 60 })
    // Added after the first click, as the outside-press listener of a surface the item opened is.
    const outside = vi.fn()
    document.addEventListener('pointerdown', outside, true)
    const under = screen.getByTestId('under')
    fireEvent.pointerDown(under, { pointerType: 'mouse', clientX: 42, clientY: 61 })
    fireEvent.pointerUp(under, { pointerType: 'mouse', clientX: 42, clientY: 61 })
    expect(pressed).not.toHaveBeenCalled()
    expect(outside).not.toHaveBeenCalled()
    // Elsewhere, or a touch, it is a new press.
    fireEvent.pointerDown(under, { pointerType: 'mouse', clientX: 200, clientY: 60 })
    fireEvent.pointerDown(under, { pointerType: 'touch', clientX: 40, clientY: 60 })
    expect(pressed).toHaveBeenCalledTimes(2)
    expect(outside).toHaveBeenCalledTimes(2)
    document.removeEventListener('pointerdown', outside, true)
  })
})

describe('useContextMenu anchors', () => {
  it('opened by a button click, hangs under that button whatever the pointer says', async () => {
    function ButtonMenu() {
      const menu = useContextMenu()
      return (
        <>
          <button onClick={(e) => menu.open(e, items(() => {}))}>more</button>
          {menu.node}
        </>
      )
    }
    render(<ButtonMenu />)
    const trigger = screen.getByText('more')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 500, top: 100, right: 524, bottom: 124, width: 24, height: 24, x: 500, y: 100, toJSON: () => ({}),
    } as DOMRect)
    // A keyboard press reports the pointer at 0,0.
    fireEvent.click(trigger, { clientX: 0, clientY: 0 })
    const menu = await screen.findByRole('menu')
    // jsdom has no layout: the menu is 0 wide, so its right edge is the button's.
    await waitFor(() => expect(menu.style.top).toBe('130px'))
    expect(menu.style.left).toBe('524px')
  })

  it('a second right-click opens a new menu instead of moving the first', async () => {
    function Row() {
      const menu = useContextMenu()
      return (
        <>
          <div onContextMenu={(e) => menu.open(e, items(() => {}))}>row</div>
          {menu.node}
        </>
      )
    }
    render(<Row />)
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 40, clientY: 50 })
    const first = await screen.findByRole('menu')
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 40, clientY: 300 })
    await waitFor(() => expect(screen.getByRole('menu')).not.toBe(first))
  })
})

describe('Menu checkbox and radio items', () => {
  function Columns() {
    const [open, setOpen] = useState(false)
    const [shown, setShown] = useState({ tags: true, notes: false })
    const [order, setOrder] = useState('added')
    const anchor = useRef<HTMLButtonElement>(null)
    const items: MenuItem[] = [
      { type: 'checkbox', label: 'Name', checked: true, disabled: true, hint: 'Always shown', onSelect: () => {} },
      { type: 'checkbox', label: 'Tags', checked: shown.tags, onSelect: () => setShown((s) => ({ ...s, tags: !s.tags })) },
      { type: 'checkbox', label: 'Notes', checked: shown.notes, onSelect: () => setShown((s) => ({ ...s, notes: !s.notes })) },
      { type: 'separator' },
      { type: 'radio', label: 'Newest first', checked: order === 'newest', onSelect: () => setOrder('newest') },
      { type: 'radio', label: 'Shops', content: <span data-testid="chip">Shops</span>, checked: false, onSelect: () => setOrder('shops') },
    ]
    return (
      <>
        <button ref={anchor} onClick={() => setOpen(true)}>columns</button>
        <Menu open={open} onOpenChange={setOpen} anchor={anchor} items={items} aria-label="Columns" />
        <output data-testid="order">{order}</output>
      </>
    )
  }

  it('a checkbox item says whether it is on, toggles in place and keeps the menu open', async () => {
    render(<Columns />)
    fireEvent.click(screen.getByText('columns'))
    const tags = await screen.findByRole('menuitemcheckbox', { name: 'Tags' })
    expect(tags).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(tags)
    expect(screen.getByRole('menuitemcheckbox', { name: 'Tags' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menu', { name: 'Columns' })).toBeInTheDocument()
  })

  it('a held Enter or Space on a checkbox item stops its own repeat, so native activation cannot fire it twice (fix round 1 item 7)', async () => {
    render(<Columns />)
    fireEvent.click(screen.getByText('columns'))
    const tags = await screen.findByRole('menuitemcheckbox', { name: 'Tags' })
    const first = createEvent.keyDown(tags, { key: 'Enter' })
    fireEvent(tags, first)
    expect(first.defaultPrevented).toBe(false)
    const repeat = createEvent.keyDown(tags, { key: 'Enter', repeat: true })
    fireEvent(tags, repeat)
    expect(repeat.defaultPrevented).toBe(true)
    const spaceRepeat = createEvent.keyDown(tags, { key: ' ', repeat: true })
    fireEvent(tags, spaceRepeat)
    expect(spaceRepeat.defaultPrevented).toBe(true)
    // A radio item is safe already: its own press closes the menu, so a
    // repeat has nothing left to reach.
    const shops = screen.getByRole('menuitemradio', { name: 'Shops' })
    const radioRepeat = createEvent.keyDown(shops, { key: 'Enter', repeat: true })
    fireEvent(shops, radioRepeat)
    expect(radioRepeat.defaultPrevented).toBe(false)
  })

  it('a hint describes its item without joining its name; a disabled item is reachable and toggles nothing', async () => {
    render(<Columns />)
    openByKeys(screen.getByText('columns'))
    // Found by 'Name' alone: the hint is its description, not part of its name.
    const name = await screen.findByRole('menuitemcheckbox', { name: 'Name' })
    expect(name).toHaveAccessibleDescription('Always shown')
    // Disabled items stay focusable (APG, plan ruling 3): the arrows reach
    // them and their hint says why they can't change.
    expect(name).toHaveAttribute('aria-disabled', 'true')
    // No hint, no description.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Notes' })).not.toHaveAttribute('aria-describedby')
    // The first enabled item has the keyboard.
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: 'Tags' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
    expect(name).toHaveFocus()
    fireEvent.click(name)
    expect(screen.getByRole('menuitemcheckbox', { name: 'Name' })).toHaveAttribute('aria-checked', 'true')
  })

  it('a radio item says which one is chosen and closes the menu', async () => {
    render(<Columns />)
    fireEvent.click(screen.getByText('columns'))
    const newest = await screen.findByRole('menuitemradio', { name: 'Newest first' })
    expect(newest).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(newest)
    expect(screen.getByTestId('order')).toHaveTextContent('newest')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('content is drawn in place of the label and still names the item; type-ahead finds it', async () => {
    render(<Columns />)
    openByKeys(screen.getByText('columns'))
    const menu = await screen.findByRole('menu')
    expect(screen.getByTestId('chip')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: 'Tags' })).toHaveFocus())
    fireEvent.keyDown(menu, { key: 's' })
    expect(screen.getByRole('menuitemradio', { name: 'Shops' })).toHaveFocus()
  })
})

describe('a right-click inside the menu (C17)', () => {
  it('never reaches an ancestor: a portaled menu is still nested in the React tree, so its own onContextMenu must stop the bubble', async () => {
    const parentSpy = vi.fn()
    function Harness() {
      const anchor = useRef<HTMLButtonElement>(null)
      return (
        // A stand-in for a row that renders a cell's own menu inside it
        // (FolderCellMenu, say): its onContextMenu must not see a
        // right-click that landed inside that menu.
        <div onContextMenu={parentSpy}>
          <button ref={anchor}>more</button>
          <Menu open onOpenChange={() => {}} anchor={anchor} items={[{ label: 'Rename', onSelect: () => {} }]} aria-label="Menu" />
        </div>
      )
    }
    render(<Harness />)
    const item = await screen.findByRole('menuitem', { name: 'Rename' })
    fireEvent.contextMenu(item)
    expect(parentSpy).not.toHaveBeenCalled()
  })
})

describe('Menu model', () => {
  const rich = (spy: (s: string) => void): MenuItem[] => [
    { type: 'label', label: 'Run' },
    { label: 'Start', onSelect: () => spy('start'), shortcut: 'S', icon: <svg data-testid="start-icon" /> },
    { label: 'Launch synced', onSelect: () => spy('sync'), disabled: true, hint: '2 mobile and 1 desktop profiles can’t sync' },
    { type: 'separator' },
    { label: 'Move to Trash', onSelect: () => spy('trash'), danger: true, shortcut: '⌫', icon: <svg data-testid="trash-icon" /> },
  ]
  function Rich({ spy, heading }: { spy: (s: string) => void; heading?: string }) {
    const [open, setOpen] = useState(false)
    const anchor = useRef<HTMLButtonElement>(null)
    return (
      <>
        <button ref={anchor} onClick={() => setOpen(true)}>more</button>
        <Menu open={open} onOpenChange={setOpen} anchor={anchor} items={rich(spy)} heading={heading} />
      </>
    )
  }

  it('the pointer moves the one highlight: the item under it takes focus', async () => {
    render(<Rich spy={() => {}} heading="Sandbox" />)
    openByKeys(screen.getByText('more'))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus())
    fireEvent.pointerMove(screen.getByRole('menuitem', { name: 'Move to Trash' }))
    expect(screen.getByRole('menuitem', { name: 'Move to Trash' })).toHaveFocus()
  })

  it('opened by the pointer, highlights nothing until the pointer moves onto an item or an arrow is pressed (Pair 30 ruling)', async () => {
    render(<Rich spy={() => {}} heading="Sandbox" />)
    const trigger = screen.getByText('more')
    openByPointer(trigger)
    const menu = await screen.findByRole('menu')
    // The menu itself has the keyboard; no item has the focus fill.
    await waitFor(() => expect(menu).toHaveFocus())
    for (const item of screen.getAllByRole('menuitem')) expect(item).not.toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus()
    // Opened by the pointer again: the pointer moving onto an item highlights it.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    openByPointer(trigger)
    await waitFor(() => expect(screen.getByRole('menu')).toHaveFocus())
    fireEvent.pointerMove(screen.getByRole('menuitem', { name: 'Move to Trash' }))
    expect(screen.getByRole('menuitem', { name: 'Move to Trash' })).toHaveFocus()
  })

  it('opened from the keys (Enter, Space, Shift+F10, the Menu key, an arrow), highlights its first item (Pair 30 ruling)', async () => {
    render(<Rich spy={() => {}} heading="Sandbox" />)
    const trigger = screen.getByText('more')
    for (const key of [{ key: 'Enter' }, { key: ' ' }, { key: 'F10', shiftKey: true }, { key: 'ContextMenu' }, { key: 'ArrowDown' }]) {
      fireEvent.keyDown(trigger, key)
      fireEvent.click(trigger)
      await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus())
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    }
  })

  it('paints no hover fill of its own: the focus fill is the one highlight (EMIL-06)', async () => {
    render(<Rich spy={() => {}} />)
    fireEvent.click(screen.getByText('more'))
    await screen.findByRole('menu')
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.className).not.toMatch(/(^|\s)(enabled:)?hover:bg-/)
      expect(item.className).toMatch(/(^|\s)focus:bg-/)
    }
  })

  it('is named by its heading and groups items under a label', async () => {
    render(<Rich spy={() => {}} heading="Sandbox" />)
    fireEvent.click(screen.getByText('more'))
    const menu = await screen.findByRole('menu', { name: 'Sandbox' })
    const group = within(menu).getByRole('group', { name: 'Run' })
    expect(within(group).getByRole('menuitem', { name: 'Start' })).toBeInTheDocument()
  })

  it('shows keys as key caps and declares them', async () => {
    render(<Rich spy={() => {}} />)
    fireEvent.click(screen.getByText('more'))
    const start = await screen.findByRole('menuitem', { name: 'Start' })
    expect(start).toHaveAttribute('aria-keyshortcuts', 'S')
    expect(start.querySelector('kbd')).toHaveTextContent('S')
    expect(screen.getByRole('menuitem', { name: 'Move to Trash' })).toHaveAttribute('aria-keyshortcuts', 'Backspace')
  })

  it('a disabled item is reachable, says why, and does nothing', async () => {
    const spy = vi.fn()
    render(<Rich spy={spy} />)
    fireEvent.click(screen.getByText('more'))
    const sync = await screen.findByRole('menuitem', { name: 'Launch synced' })
    expect(sync).toHaveAttribute('aria-disabled', 'true')
    expect(sync).toHaveAccessibleDescription('2 mobile and 1 desktop profiles can’t sync')
    fireEvent.click(sync)
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('a danger item\'s icon takes the item\'s color', async () => {
    render(<Rich spy={() => {}} />)
    fireEvent.click(screen.getByText('more'))
    await screen.findByRole('menu')
    expect(screen.getByTestId('trash-icon').parentElement!.className).toContain('text-current')
    expect(screen.getByTestId('start-icon').parentElement!.className).not.toContain('text-current')
  })

  it('Tab closes the menu and puts focus back on its button', async () => {
    render(<Rich spy={() => {}} />)
    const trigger = screen.getByText('more')
    trigger.focus()
    openByKeys(trigger)
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus())
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    menu.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('a key an item shows runs that item from the open menu (Pair 30 review, Important 2)', async () => {
    const spy = vi.fn()
    render(<Rich spy={spy} />)
    const trigger = screen.getByText('more')
    trigger.focus()
    openByPointer(trigger)
    const menu = await screen.findByRole('menu')
    // S is Start's key, not a jump to the first item that starts with S.
    fireEvent.keyDown(menu, { key: 's', code: 'KeyS' })
    expect(spy).toHaveBeenCalledWith('start')
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    expect(trigger).toHaveFocus()
    // By its place on a layout without Latin letters (A11Y-02); ⌫ is Backspace.
    openByPointer(trigger)
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'ы', code: 'KeyS' })
    expect(spy).toHaveBeenCalledTimes(2)
    openByPointer(trigger)
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Backspace', code: 'Backspace' })
    expect(spy).toHaveBeenLastCalledWith('trash')
    // A held key runs nothing more.
    openByPointer(trigger)
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 's', code: 'KeyS', repeat: true })
    expect(spy).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('a disabled item\'s key takes the highlight to it and runs nothing', async () => {
    const spy = vi.fn()
    const list: MenuItem[] = [
      { label: 'Start', onSelect: () => spy('start') },
      { label: 'Launch synced', onSelect: () => spy('sync'), disabled: true, hint: 'Mixed', shortcut: 'L' },
    ]
    function Keyed() {
      const [open, setOpen] = useState(false)
      const anchor = useRef<HTMLButtonElement>(null)
      return <><button ref={anchor} onClick={() => setOpen(true)}>more</button><Menu open={open} onOpenChange={setOpen} anchor={anchor} items={list} /></>
    }
    render(<Keyed />)
    openByPointer(screen.getByText('more'))
    const menu = await screen.findByRole('menu')
    fireEvent.keyDown(menu, { key: 'l', code: 'KeyL' })
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Launch synced' })).toHaveFocus()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('Enter and Space run the highlighted item and Esc closes, even when an item declares them (Pair 36 review, Important 1)', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    const list: MenuItem[] = [
      { label: 'Open in Peek', onSelect: () => spy('peek'), shortcut: 'Enter', ariaKeyShortcuts: 'Enter Space Escape' },
      { label: 'Start', onSelect: () => spy('start') },
      { label: 'Rename', onSelect: () => spy('rename') },
    ]
    function Keyed() {
      const [open, setOpen] = useState(false)
      const anchor = useRef<HTMLButtonElement>(null)
      return <><button ref={anchor} onClick={() => setOpen(true)}>more</button><Menu open={open} onOpenChange={setOpen} anchor={anchor} items={list} /></>
    }
    render(<Keyed />)
    const trigger = screen.getByText('more')
    trigger.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open in Peek' })).toHaveFocus())
    await user.keyboard('{ArrowDown}{Enter}')
    expect(spy).toHaveBeenCalledExactlyOnceWith('start')
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open in Peek' })).toHaveFocus())
    await user.keyboard('{ArrowDown}{ArrowDown}[Space]')
    expect(spy).toHaveBeenLastCalledWith('rename')
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open in Peek' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('a menu key held with a modifier runs the item that declares it (Pair 36 re-review, Minor 1)', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    const list: MenuItem[] = [
      { label: 'Start', onSelect: () => spy('start') },
      { label: 'Open in new window', onSelect: () => spy('window'), shortcut: 'Ctrl+Enter', ariaKeyShortcuts: 'Control+Enter Shift+ArrowDown' },
      { label: 'Rename', onSelect: () => spy('rename') },
    ]
    function Keyed() {
      const [open, setOpen] = useState(false)
      const anchor = useRef<HTMLButtonElement>(null)
      return <><button ref={anchor} onClick={() => setOpen(true)}>more</button><Menu open={open} onOpenChange={setOpen} anchor={anchor} items={list} /></>
    }
    render(<Keyed />)
    const trigger = screen.getByText('more')
    trigger.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus())
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(spy).toHaveBeenCalledExactlyOnceWith('window')
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus())
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(spy).toHaveBeenLastCalledWith('window')
    await waitFor(() => expect(trigger).toHaveFocus())
    // Unmodified, they stay the menu's.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus())
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(spy).toHaveBeenLastCalledWith('rename')
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('a keyboard pick puts focus back on the button', async () => {
    const spy = vi.fn()
    render(<Rich spy={spy} />)
    const trigger = screen.getByText('more')
    trigger.focus()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveFocus())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start' }), { detail: 0 })
    expect(spy).toHaveBeenCalledWith('start')
    expect(trigger).toHaveFocus()
  })
})

describe('useContextMenu host', () => {
  it('opening the menu does not re-render the component that owns it (PERF-11)', async () => {
    let renders = 0
    function Owner() {
      renders++
      const menu = useContextMenu()
      return <><div onContextMenu={(e) => menu.openAtPointer(e, items(() => {}))}>row</div>{menu.node}</>
    }
    render(<Owner />)
    const base = renders
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 40, clientY: 50 })
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(renders).toBe(base)
  })

  it('returns the same object every render', () => {
    const seen: unknown[] = []
    function Owner({ n }: { n: number }) {
      const menu = useContextMenu()
      seen.push(menu)
      return <span>{n}{menu.node}</span>
    }
    const { rerender } = render(<Owner n={1} />)
    rerender(<Owner n={2} />)
    expect(seen[0]).toBe(seen[1])
  })

  it('openFrom hangs the menu under a button and marks it expanded while open', async () => {
    function Owner() {
      const menu = useContextMenu()
      return <><button aria-haspopup="menu" onClick={(e) => menu.openFrom(e.currentTarget, items(() => {}))}>more</button>{menu.node}</>
    }
    render(<Owner />)
    const more = screen.getByText('more')
    fireEvent.click(more)
    await screen.findByRole('menu')
    expect(more).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(more).toHaveAttribute('aria-expanded', 'false'))
  })

  it('a contextmenu with no pointer (Shift+F10, the Menu key) opens at the element (PC-006)', async () => {
    function Row() {
      const menu = useContextMenu()
      return <><div tabIndex={0} onContextMenu={(e) => menu.openAtPointer(e, items(() => {}))}>row</div>{menu.node}</>
    }
    render(<Row />)
    const el = screen.getByText('row')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 300, top: 200, right: 700, bottom: 236, width: 400, height: 36, x: 300, y: 200, toJSON: () => ({}) } as DOMRect)
    fireEvent.contextMenu(el, { clientX: 0, clientY: 0 })
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu.style.top).toBe('238px'))
    expect(menu.style.left).toBe('300px')
  })

  it('marks what the open menu is for with data-menu-open, so a row can keep its controls in view without rendering', async () => {
    function Owner() {
      const menu = useContextMenu()
      return (
        <>
          <div data-testid="row" onContextMenu={(e) => menu.openAtPointer(e, items(() => {}))}>row</div>
          <button onClick={(e) => menu.openFrom(e.currentTarget, items(() => {}))}>more</button>
          {menu.node}
        </>
      )
    }
    render(<Owner />)
    const row = screen.getByTestId('row')
    const more = screen.getByText('more')
    fireEvent.contextMenu(row, { clientX: 40, clientY: 50 })
    await screen.findByRole('menu')
    expect(row).toHaveAttribute('data-menu-open')
    // A new opening moves the mark.
    fireEvent.click(more)
    await waitFor(() => expect(more).toHaveAttribute('data-menu-open'))
    expect(row).not.toHaveAttribute('data-menu-open')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(more).not.toHaveAttribute('data-menu-open'))
  })
})
