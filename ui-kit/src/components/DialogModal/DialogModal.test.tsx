import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DialogModal from '.'
import AlertModal from '../AlertModal'

describe('DialogModal and AlertModal while closing', () => {
  it('DialogModal leaves inert: its buttons take no clicks and no focus', () => {
    const onConfirm = vi.fn()
    const { rerender } = render(<DialogModal open onClose={() => {}} title="Move" confirmLabel="Move" onConfirm={onConfirm} />)
    rerender(<DialogModal open={false} onClose={() => {}} title="Move" confirmLabel="Move" onConfirm={onConfirm} />)
    const panel = screen.getByRole('dialog', { hidden: true })
    expect(panel.closest('[inert]')).not.toBeNull()
  })

  it('AlertModal leaves inert too', () => {
    const { rerender } = render(<AlertModal open onClose={() => {}} title="Delete" />)
    rerender(<AlertModal open={false} onClose={() => {}} title="Delete" />)
    expect(screen.getByRole('alertdialog', { hidden: true }).closest('[inert]')).not.toBeNull()
  })
})

describe('DialogModal form', () => {
  it('footerNote shows its words in the footer, before Cancel', () => {
    render(<DialogModal open onClose={() => {}} title="Edit" confirmLabel="Save" onConfirm={() => {}} isDisabled footerNote="Enter a name" />)
    const note = screen.getByText('Enter a name')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(note.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Enter in a field submits once', async () => {
    const onConfirm = vi.fn()
    render(<DialogModal open onClose={() => {}} title="New bookmark" confirmLabel="Save" onConfirm={onConfirm}><input aria-label="Address" /></DialogModal>)
    await userEvent.type(screen.getByLabelText('Address'), 'example.com{Enter}')
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('Enter does nothing while the confirm is disabled or busy', async () => {
    const onConfirm = vi.fn()
    const { rerender } = render(<DialogModal open onClose={() => {}} title="x" confirmLabel="Save" onConfirm={onConfirm} isDisabled><input aria-label="Name" /></DialogModal>)
    await userEvent.type(screen.getByLabelText('Name'), 'a{Enter}')
    rerender(<DialogModal open onClose={() => {}} title="x" confirmLabel="Save" onConfirm={onConfirm} isLoading><input aria-label="Name" /></DialogModal>)
    await userEvent.type(screen.getByLabelText('Name'), 'b{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('in a textarea, Enter is a new line and Cmd/Ctrl+Enter submits', async () => {
    const onConfirm = vi.fn()
    render(<DialogModal open onClose={() => {}} title="Import" confirmLabel="Import" onConfirm={onConfirm}><textarea aria-label="Lines" /></DialogModal>)
    const area = screen.getByLabelText('Lines')
    await userEvent.type(area, 'a{Enter}b')
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.keyDown(area, { key: 'Enter', metaKey: true })
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  // Pair 20 and 25 carry: a field that keeps its Enter prevents its default.
  it('a Cmd/Ctrl+Enter a field kept for itself submits nothing', () => {
    const onConfirm = vi.fn()
    render(
      <DialogModal open onClose={() => {}} title="Import" confirmLabel="Import" onConfirm={onConfirm}>
        <textarea aria-label="Lines" onKeyDown={(e) => e.preventDefault()} />
      </DialogModal>,
    )
    fireEvent.keyDown(screen.getByLabelText('Lines'), { key: 'Enter', ctrlKey: true })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a destructive confirm makes it an alertdialog', () => {
    render(<DialogModal open onClose={() => {}} title="Delete proxy?" confirmLabel="Delete proxy" confirmVariant="error" onConfirm={() => {}} />)
    expect(screen.getByRole('alertdialog', { name: 'Delete proxy?' })).toBeInTheDocument()
  })

  it('a confirm needs its words', () => {
    // @ts-expect-error: confirmLabel is required with onConfirm (WRITE-02, EMIL-10)
    render(<DialogModal open onClose={() => {}} title="x" onConfirm={() => {}} />)
  })

  it("the icon sits on the title's center line", () => {
    render(<DialogModal open onClose={() => {}} title="New folder" icon={<svg />} />)
    expect(screen.getByRole('heading', { name: 'New folder' }).closest('.flex.items-center')).not.toBeNull()
  })

  it('the confirm keeps its busy words while the dialog leaves', () => {
    const { rerender } = render(<DialogModal open onClose={() => {}} title="Add" confirmLabel="Adding…" onConfirm={() => {}} isLoading />)
    rerender(<DialogModal open={false} onClose={() => {}} title="Add" confirmLabel="Add 3" onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: 'Adding…', hidden: true })).toBeInTheDocument()
  })
})

describe('DialogModal Cancel', () => {
  it('asks before Cancel closes a dirty dialog', async () => {
    const spy = vi.fn()
    render(<DialogModal open dirty title="T" onConfirm={() => {}} confirmLabel="Save" onOpenChange={spy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it('Cancel closes a clean dialog at once', () => {
    const spy = vi.fn()
    render(<DialogModal open title="T" onConfirm={() => {}} confirmLabel="Save" onOpenChange={spy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(spy).toHaveBeenCalledWith(false)
  })

  it('a dirty dialog runs its onCancel only once Discard is chosen', async () => {
    const onCancel = vi.fn()
    const spy = vi.fn()
    render(<DialogModal open dirty title="T" onConfirm={() => {}} confirmLabel="Save" onOpenChange={spy} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('AlertModal', () => {
  it('focuses Cancel first, even with a "Don’t show again" box (PC-003)', async () => {
    render(<AlertModal open onClose={() => {}} title="Delete" confirmLabel="Delete" onConfirm={() => {}} showDontShowAgain />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    expect(screen.getByRole('alertdialog', { name: 'Delete' })).toBeInTheDocument()
  })
})
