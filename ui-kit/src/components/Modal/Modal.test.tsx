import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Modal from '.'
import Select from '../Select'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete folder" closeLabel="Close dialog">
        <button>keep profiles</button>
        <button>delete all</button>
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('is labelled by its title and focuses the first action, not the close button', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('open'))
    expect(screen.getByRole('dialog', { name: 'Delete folder' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('keep profiles')).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument()
  })

  it('keeps Tab inside and returns focus to the opener on close', async () => {
    render(<Harness />)
    const opener = screen.getByText('open')
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByText('keep profiles')).toHaveFocus())
    screen.getByText('delete all').focus()
    fireEvent.keyDown(screen.getByText('delete all'), { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
    // The one close button (C20a) shows its tooltip after a Tab, and the
    // first Esc hides only the tooltip (A11Y-12); the next one closes.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).toHaveFocus()
  })

  it('ignores Escape while closed', () => {
    const onClose = vi.fn()
    render(<Modal open={false} onClose={onClose} title="x" />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes only the top dialog on Escape and keeps the page locked until both close', async () => {
    const closeBottom = vi.fn()
    const closeTop = vi.fn()
    const { rerender } = render(
      <>
        <Modal open onClose={closeBottom} title="bottom" />
        <Modal open onClose={closeTop} title="top" />
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeTop).toHaveBeenCalledOnce()
    expect(closeBottom).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <>
        <Modal open onClose={closeBottom} title="bottom" />
        <Modal open={false} onClose={closeTop} title="top" />
      </>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <>
        <Modal open={false} onClose={closeBottom} title="bottom" />
        <Modal open={false} onClose={closeTop} title="top" />
      </>,
    )
    await waitFor(() => expect(document.body.style.overflow).toBe(''))
  })

  it('lets Escape close a Select list inside it without closing the dialog', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Proxy">
        <Select aria-label="Proxy type" value="a" options={[{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }]} />
      </Modal>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Proxy type' }))
    expect(await screen.findByRole('option', { name: 'Beta' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Beta' })).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a backdrop press while a Select list is open closes only the list', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Proxy">
        <Select aria-label="Proxy type" value="a" options={[{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }]} />
      </Modal>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Proxy type' }))
    expect(await screen.findByRole('option', { name: 'Beta' })).toBeInTheDocument()
    const backdrop = document.querySelector<HTMLElement>('[data-dialog-backdrop]')!
    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Beta' })).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a backdrop press with nothing above it closes the dialog', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="x" />)
    const backdrop = document.querySelector<HTMLElement>('[data-dialog-backdrop]')!
    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('an untitled dialog can be named with aria-label', () => {
    render(<Modal open onClose={() => {}} aria-label="Star us on GitHub"><button>ok</button></Modal>)
    expect(screen.getByRole('dialog', { name: 'Star us on GitHub' })).toBeInTheDocument()
  })
  it('can sit near the top of the window, with a body that draws its own padding', () => {
    render(<Modal open onClose={() => {}} aria-label="Palette" placement="top" padded={false} showClose={false}><button>x</button></Modal>)
    expect(screen.getByRole('dialog', { name: 'Palette' }).parentElement).toHaveAttribute('data-placement', 'top')
    expect(screen.getByText('x').parentElement).not.toHaveClass('p-5')
  })
})

describe('Modal enter and exit', () => {
  it('while leaving it is inert and lets the pointer through, from the commit that closed it', () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="x" />)
    rerender(<Modal open={false} onClose={() => {}} title="x" />)
    const panel = screen.getByRole('dialog', { hidden: true })
    // The frame's root: inert and marked leaving in the same commit as the close.
    const root = panel.closest('[inert]')
    expect(root).not.toBeNull()
    expect(root).toHaveAttribute('data-ending-style')
    expect(panel).toHaveAttribute('data-ending-style')
  })

  it('with exit="instant" is gone the moment it closes', () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="x" exit="instant" />)
    rerender(<Modal open={false} onClose={() => {}} title="x" exit="instant" />)
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
  })

  it('has its own backdrop layer: a press on it closes, a press on the panel does not', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="x"><button>inside</button></Modal>)
    const backdrop = document.querySelector<HTMLElement>('[data-dialog-backdrop]')!
    expect(backdrop).toHaveAttribute('aria-hidden', 'true')
    fireEvent.pointerDown(screen.getByText('inside'))
    fireEvent.click(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('says how it moves: quick for the palette, and which input opened it', () => {
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    render(<Modal open onClose={() => {}} aria-label="Command palette" motion="quick" />)
    const panel = screen.getByRole('dialog', { name: 'Command palette' })
    expect(panel.closest('[data-motion]')).toHaveAttribute('data-motion', 'quick')
    expect(panel).toHaveAttribute('data-input', 'keyboard')
  })
})

describe('Modal shell', () => {
  // 2 px under the round sizes: the 1 px border is gone (borderless, owner
  // 2026-10-01) and the content keeps its width.
  it('has three sizes; the palette keeps its own width', () => {
    const { rerender } = render(<Modal open onOpenChange={() => {}} title="x" size="sm" />)
    expect(screen.getByRole('dialog').className).toContain('max-w-[398px]')
    rerender(<Modal open onOpenChange={() => {}} title="x" />)
    expect(screen.getByRole('dialog').className).toContain('max-w-[478px]')
    rerender(<Modal open onOpenChange={() => {}} title="x" size="lg" />)
    expect(screen.getByRole('dialog').className).toContain('max-w-[718px]')
    rerender(<Modal open onOpenChange={() => {}} title="x" maxWidthClassName="max-w-[560px]" />)
    expect(screen.getByRole('dialog').className).toContain('max-w-[560px]')
  })

  it('is described by its description, and can be an alertdialog', () => {
    render(<Modal open onOpenChange={() => {}} role="alertdialog" title="Empty Trash?" description="3 profiles are deleted for good." />)
    expect(screen.getByRole('alertdialog', { name: 'Empty Trash?' })).toHaveAccessibleDescription('3 profiles are deleted for good.')
  })

  it('asks for false through onOpenChange and still calls onClose', () => {
    const onOpenChange = vi.fn()
    const onClose = vi.fn()
    render(<Modal open onOpenChange={onOpenChange} onClose={onClose} title="x" />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('with unsaved input, Esc and the close button ask first', async () => {
    const onOpenChange = vi.fn()
    render(<Modal open onOpenChange={onOpenChange} title="Import proxies" dirty><textarea aria-label="lines" /></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    const ask = await screen.findByRole('alertdialog', { name: 'Discard your changes?' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(ask).not.toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // Owner: the one close button draws at 21 px with a 24 px hit area.
  it('closes with the one dismiss button', () => {
    render(<Modal open onOpenChange={() => {}} title="x" />)
    expect(screen.getByRole('button', { name: 'Close' }).className).toContain('size-[21px]')
  })

  it('keeps what it showed while it leaves: a busy label does not flip back under the fade', () => {
    const { rerender } = render(<Modal open title="Import" footer={<button type="button">Adding…</button>} />)
    rerender(<Modal open={false} title="Import" footer={<button type="button">Add 3</button>} />)
    expect(screen.getByRole('button', { name: 'Adding…', hidden: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add 3', hidden: true })).toBeNull()
  })
})

function Stack({ top }: { top: boolean }) {
  return (
    <>
      <Harness />
      {top && <Modal open onClose={() => {}} title="top" />}
    </>
  )
}

describe('Modal: the page behind', () => {
  it('makes #root inert while open, counted, and hands focus back to the opener in #root', async () => {
    const root = document.body.appendChild(document.createElement('div'))
    root.id = 'root'
    const { rerender } = render(<Stack top={false} />, { container: root })
    const opener = screen.getByText('open')
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByText('keep profiles')).toHaveFocus())
    expect(root).toHaveAttribute('inert')
    // A second dialog over the first: closing it keeps the page inert.
    rerender(<Stack top />)
    rerender(<Stack top={false} />)
    expect(root).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(root).not.toHaveAttribute('inert')
    expect(opener).toHaveFocus()
    root.remove()
  })
})
