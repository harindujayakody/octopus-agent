import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CopyButton from '.'

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => vi.useRealTimers())

describe('CopyButton', () => {
  it('says Copied where the click was, for a moment, and tells a screen reader', async () => {
    const onCopy = vi.fn(async () => {})
    render(<CopyButton onCopy={onCopy} label="Copy URL" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy URL' })) })
    expect(onCopy).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
    act(() => { vi.advanceTimersByTime(1500) })
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument()
  })

  it('says nothing when the copy failed', async () => {
    render(<CopyButton onCopy={() => Promise.reject(new Error('no'))} label="Copy URL" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy URL' })) })
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument()
  })

  it('can show its words', async () => {
    render(<CopyButton withText onCopy={async () => {}} label="Copy ID" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy ID' })) })
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveTextContent('Copied')
  })

  it('takes its default words from the labels (the app passes them in its language)', () => {
    render(<CopyButton onCopy={async () => {}} />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })
})
