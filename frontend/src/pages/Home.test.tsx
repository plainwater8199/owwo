import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

describe('Home 首页', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('未登录时右上角渲染登录入口,指向 /login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: '未登录' }), { status: 401 }),
      ),
    )
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    const loginLink = await screen.findByRole('link', { name: /登录/ })
    expect(loginLink).toBeInTheDocument()
    expect(loginLink).toHaveAttribute('href', '/login')
  })

  it('已登录时显示当前用户名,不再显示登录入口', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'alice' }), { status: 200 }),
      ),
    )
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/alice/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /登录/ })).not.toBeInTheDocument()
  })

  it('已登录时显示进入 Hermes 的链接,指向 Hermes 子域', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'alice' }), { status: 200 }),
      ),
    )
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    const hermesLink = await screen.findByRole('link', { name: /进入 Hermes/ })
    expect(hermesLink).toHaveAttribute('href', expect.stringContaining('hermes.localhost'))
  })
})
