import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Switch from '.'
import { CheckIcon } from '@/lib/icons'

describe('Switch and icons', () => {
  it('is announced as a switch', () => {
    render(<Switch label="Minimize to tray" />)
    expect(screen.getByRole('switch', { name: 'Minimize to tray' })).toBeInTheDocument()
  })

  it('kit icons are hidden from screen readers by default', () => {
    const { container } = render(<CheckIcon />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('an icon given a role is announced', () => {
    const { container } = render(<CheckIcon role="img" aria-label="Done" />)
    expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden')
  })
})
