import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import IconSwap from '.'

describe('IconSwap', () => {
  it('keeps both icons in the DOM and marks the one shown', () => {
    const { container, rerender } = render(<IconSwap on={false} onIcon={<i data-i="stop" />} offIcon={<i data-i="play" />} />)
    const slot = (name: string) => container.querySelector(`[data-i="${name}"]`)!.parentElement!
    expect(slot('play')).toHaveAttribute('data-on')
    expect(slot('stop')).not.toHaveAttribute('data-on')
    rerender(<IconSwap on onIcon={<i data-i="stop" />} offIcon={<i data-i="play" />} />)
    expect(slot('stop')).toHaveAttribute('data-on')
    expect(slot('play')).not.toHaveAttribute('data-on')
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
