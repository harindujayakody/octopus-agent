import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import Tabs, { TabPanel, tabIds } from '.'

function Harness({ orientation }: { orientation?: 'horizontal' | 'vertical' }) {
  const [value, setValue] = useState('step')
  return (
    <Tabs
      aria-label="Editor panels"
      orientation={orientation}
      value={value}
      onChange={setValue}
      items={[
        { label: 'Step', value: 'step' },
        { label: 'Traffic', value: 'traffic' },
        { label: 'Console', value: 'console', disabled: true },
      ]}
    />
  )
}

describe('Tabs', () => {
  it('a badge follows the label and is part of the tab name', () => {
    render(<Tabs aria-label="Form" value="a" onChange={() => {}} items={[{ label: 'Basics', value: 'a', badge: <span>Changed</span> }, { label: 'Proxy', value: 'b' }]} />)
    expect(screen.getByRole('tab', { name: 'Basics Changed' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Proxy' })).toBeInTheDocument()
  })

  it('is a tablist with one tabbable tab that selects on click', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: 'Editor panels' })).toBeInTheDocument()
    const step = screen.getByRole('tab', { name: 'Step' })
    const traffic = screen.getByRole('tab', { name: 'Traffic' })
    expect(step).toHaveAttribute('aria-selected', 'true')
    expect(step).toHaveAttribute('tabindex', '0')
    expect(traffic).toHaveAttribute('tabindex', '-1')
    fireEvent.click(traffic)
    expect(traffic).toHaveAttribute('aria-selected', 'true')
  })

  it('moves and selects with the arrow keys, skipping disabled tabs', () => {
    render(<Harness />)
    const step = screen.getByRole('tab', { name: 'Step' })
    step.focus()
    fireEvent.keyDown(step, { key: 'ArrowRight' })
    const traffic = screen.getByRole('tab', { name: 'Traffic' })
    expect(traffic).toHaveFocus()
    expect(traffic).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(traffic, { key: 'ArrowRight' })
    expect(step).toHaveFocus()
  })

  it('uses up and down when vertical', () => {
    render(<Harness orientation="vertical" />)
    const step = screen.getByRole('tab', { name: 'Step' })
    step.focus()
    fireEvent.keyDown(step, { key: 'ArrowDown' })
    expect(screen.getByRole('tab', { name: 'Traffic' })).toHaveFocus()
  })
})

describe('Tabs and panels', () => {
  const items = [{ label: 'General', value: 'general' }, { label: 'API', value: 'api' }]
  it('the selected tab controls its panel, and the panel is named by its tab', () => {
    render(<><Tabs idBase="settings" items={items} value="api" onChange={() => {}} aria-label="Sections" /><TabPanel tabsId="settings" value="api">API settings</TabPanel></>)
    const tab = screen.getByRole('tab', { name: 'API' })
    const panel = screen.getByRole('tabpanel', { name: 'API' })
    expect(tab).toHaveAttribute('aria-controls', panel.id)
    expect(screen.getByRole('tab', { name: 'General' })).not.toHaveAttribute('aria-controls')
  })

  it('without idBase no tab points at a panel; ids never collide (Pair 28 review I1, M1)', () => {
    render(<Tabs items={items} value="api" onChange={() => {}} aria-label="Sections" />)
    expect(screen.getByRole('tab', { name: 'API' })).not.toHaveAttribute('aria-controls')
    expect(tabIds('x', '存储').tab).not.toBe(tabIds('x', '设置').tab)
    expect(tabIds('x', 'a b').tab).not.toBe(tabIds('x', 'a_b').tab)
    expect(tabIds('x', 'api-mcp').tab).toBe('x-tab-api-mcp')
  })

  it('an unknown or disabled current value still leaves one tab reachable (PC-001)', () => {
    render(<Tabs items={[{ label: 'A', value: 'a', disabled: true }, { label: 'B', value: 'b' }]} value="a" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('tabindex', '0')
  })

  it('does not throw when every tab is disabled', () => {
    render(<Tabs items={[{ label: 'A', value: 'a', disabled: true }]} value="a" onChange={() => {}} />)
    expect(() => fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })).not.toThrow()
  })
})
