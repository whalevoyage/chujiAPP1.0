// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MoreEntry, PasswordField } from './components'

describe('profile components', () => {
  it('opens a profile destination when a MoreEntry is selected', () => {
    const onClick = vi.fn()
    render(<MoreEntry icon={<span aria-hidden="true">D</span>} title="我的日记" onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: /我的日记/ }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps password input controlled and masked', () => {
    const onChange = vi.fn()
    render(<PasswordField label="新密码" value="secret" onChange={onChange} />)
    const input = screen.getByLabelText('新密码') as HTMLInputElement

    expect(input.type).toBe('password')
    expect(input.value).toBe('secret')
    fireEvent.change(input, { target: { value: 'new-secret' } })
    expect(onChange).toHaveBeenCalledWith('new-secret')
  })
})
