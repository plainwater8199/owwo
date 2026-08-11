import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import Login from './Login'

/**
 * 以指定路径渲染,根路由挂一个可识别的首页占位用于断言「无 next 时跳首页」。
 * 同时 stub window.location 以便捕获「带 next 时外部跳转」对 href 的赋值。
 */
function renderAt(initialPath = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="home">首页</div> },
      { path: '/login', element: <Login /> },
    ],
    { initialEntries: [initialPath] },
  )
  render(<RouterProvider router={router} />)
}

function stubLocation() {
  const loc = { href: '' }
  Object.defineProperty(window, 'location', {
    value: loc,
    writable: true,
    configurable: true,
  })
  return loc
}

describe('Login 登录页', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    stubLocation()
  })

  it('提交有效凭据后(无 next)跳转到 /', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'alice' }), { status: 200 }),
      ),
    )
    renderAt('/login')

    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: /登录/ }))

    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
  })

  it('凭据无效时显示错误且不跳转', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: '用户名或密码错误' }), { status: 401 }),
      ),
    )
    renderAt('/login')

    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /登录/ }))

    expect(await screen.findByText(/用户名或密码错误/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument()
  })

  it('带 next 参数登录成功后跳转到 next 指定的 Hermes URL', async () => {
    const loc = stubLocation()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'alice' }), { status: 200 }),
      ),
    )
    renderAt('/login?next=http://hermes.localhost:8080')

    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: /登录/ }))

    await waitFor(() => expect(loc.href).toBe('http://hermes.localhost:8080'))
  })

  it('next 指向非允许域时不跳转外部(防 open redirect)', async () => {
    const loc = stubLocation()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'alice' }), { status: 200 }),
      ),
    )
    renderAt('/login?next=http://evil.example.com')

    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: /登录/ }))

    // 非允许域 → 回退到首页(不跳外部)
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
    expect(loc.href).toBe('')
  })
})
