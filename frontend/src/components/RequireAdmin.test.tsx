import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import RequireAdmin from './RequireAdmin'

/** 用 memory router 渲染:根路由放首页占位,/admin/users 放守卫 + 一个可识别的子内容。 */
function renderGuard(meResponse: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(meResponse))
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="home">首页</div> },
      {
        path: '/admin/users',
        element: (
          <RequireAdmin>
            <div data-testid="guarded">受保护内容</div>
          </RequireAdmin>
        ),
      },
    ],
    { initialEntries: ['/admin/users'] },
  )
  render(<RouterProvider router={router} />)
}

describe('RequireAdmin 路由守卫', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('当前用户是管理员 → 渲染子内容', async () => {
    renderGuard(
      new Response(JSON.stringify({ username: 'water', is_admin: true }), { status: 200 }),
    )

    expect(await screen.findByTestId('guarded')).toBeInTheDocument()
  })

  it('当前用户非管理员 → 重定向首页', async () => {
    renderGuard(
      new Response(JSON.stringify({ username: 'alice', is_admin: false }), { status: 200 }),
    )

    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
    expect(screen.queryByTestId('guarded')).not.toBeInTheDocument()
  })
})
