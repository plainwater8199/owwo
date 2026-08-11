import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

describe('Home 首页', () => {
  it('右上角渲染登录入口,指向 /login', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )
    const loginLink = screen.getByRole('link', { name: /登录/ })
    expect(loginLink).toBeInTheDocument()
    expect(loginLink).toHaveAttribute('href', '/login')
  })
})
