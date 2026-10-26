import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LabelsProvider, fill } from './labels'
import Alert from '@/components/Alert'
import Tag from '@/components/Tag'
import Select from '@/components/Select'
import Modal from '@/components/Modal'

const zh = { close: '关闭', dismiss: '关闭通知', remove: '移除', select: '请选择…' }

describe('LabelsProvider', () => {
  it('gives kit components their words', () => {
    render(
      <LabelsProvider labels={zh}>
        <Alert onClose={() => {}}>x</Alert>
        <Tag onRemove={() => {}}>8080</Tag>
        <Select aria-label="语言" options={[{ label: 'English', value: 'en' }]} />
        <Modal open onClose={() => {}} title="标题" />
      </LabelsProvider>,
    )
    expect(screen.getByRole('button', { name: '关闭通知' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除' })).toBeInTheDocument()
    expect(screen.getByText('请选择…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('an explicit prop still wins', () => {
    render(
      <LabelsProvider labels={zh}>
        <Modal open onClose={() => {}} title="x" closeLabel="Close the sheet" />
      </LabelsProvider>,
    )
    expect(screen.getByRole('button', { name: 'Close the sheet' })).toBeInTheDocument()
  })

  it('without a provider the dashboard keeps English', () => {
    render(<Alert onClose={() => {}}>x</Alert>)
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('fills placeholders', () => {
    expect(fill('Page {current} of {total}', { current: 2, total: 9 })).toBe('Page 2 of 9')
    expect(fill('Create “{query}”', { query: 'Ads' })).toBe('Create “Ads”')
  })
})
