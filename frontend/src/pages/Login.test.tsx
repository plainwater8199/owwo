import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import Login from './Login'

/** 以 /login 为初始路由渲染,根路由挂一个可识别的首页占位用于断言跳转。 */
function renderAtLogin() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="home">首页</div> },
      { path: '/login', element: <Login /> },
    ],
    { initialEntries: ['/login'] },
  )
  render(<RouterProvider router={router} />)
}

describe('Login 登录页', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('提交有效凭据后跳转到 /', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ username: 'alice' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAtLogin()

    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: /登录/ }))

    // 成功 → 真正导航到首页(根路由占位出现)
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/login',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('凭据无效时显示错误且不跳转', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: '用户名或密码错误' }), { status: 401 }),
      ),
    )
    renderAtLogin()

    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /登录/ }))

    // 显示后端返回的错误,仍停留在登录页
    expect(await screen.findByText(/用户名或密码错误/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument()
  })
})
