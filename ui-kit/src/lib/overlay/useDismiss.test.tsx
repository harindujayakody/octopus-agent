import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDismiss } from './useDismiss'

function Layer({ name, onDismiss, enabled = true }: { name: string; onDismiss: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss({ enabled, onDismiss, refs: [ref] })
  return <div ref={ref} data-testid={name}>{name}</div>
}

describe('useDismiss', () => {
  it('closes on Escape', () => {
    const onDismiss = vi.fn()
    render(<Layer name="a" onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('closes on a press outside, not inside', () => {
    const onDismiss = vi.fn()
    const { getByTestId } = render(<><Layer name="a" onDismiss={onDismiss} /><button>outside</button></>)
    fireEvent.pointerDown(getByTestId('a'))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('treats a press inside an overlay branch (the toast stack) as neither inside nor outside', () => {
    const onDismiss = vi.fn()
    const { getByText } = render(<><Layer name="a" onDismiss={onDismiss} /><section data-overlay-branch><button>Dismiss toast</button></section></>)
    fireEvent.pointerDown(getByText('Dismiss toast'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('treats a press on an outside mark inside a branch (a toast action) as a press outside', () => {
    const onDismiss = vi.fn()
    const { getByText } = render(<><Layer name="a" onDismiss={onDismiss} /><section data-overlay-branch><button>Dismiss toast</button><button data-overlay-outside>Assign a proxy</button></section></>)
    fireEvent.pointerDown(getByText('Dismiss toast'))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.pointerDown(getByText('Assign a proxy'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('lets only the topmost layer react', () => {
    const bottom = vi.fn()
    const top = vi.fn()
    render(<><Layer name="bottom" onDismiss={bottom} /><Layer name="top" onDismiss={top} /></>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(top).toHaveBeenCalledOnce()
    expect(bottom).not.toHaveBeenCalled()
  })

  it('ignores everything while disabled', () => {
    const onDismiss = vi.fn()
    render(<Layer name="a" onDismiss={onDismiss} enabled={false} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores Escape while an input method is composing', () => {
    const onDismiss = vi.fn()
    render(<Layer name="a" onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
