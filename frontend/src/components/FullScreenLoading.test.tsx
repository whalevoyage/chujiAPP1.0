// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FullScreenLoading from './FullScreenLoading'

describe('FullScreenLoading', () => {
  it('announces the loading state to assistive technology', () => {
    render(<FullScreenLoading />)

    expect(screen.getByRole('status').textContent).toBe('加载中...')
  })
})
