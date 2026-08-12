import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import AdminUsers from './AdminUsers'

const USERS = [
  { username: 'alice', phone: '13800001111', disabled: false, is_admin: false },
  { username: 'bob', phone: '13900002222', disabled: true, is_admin: false },
]

/** 渲染 /admin/users,根路由挂首页占位用于断言「403 跳首页」。 */
function renderAdmin() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="home">首页</div> },
      { path: '/admin/users', element: <AdminUsers /> },
    ],
    { initialEntries: ['/admin/users'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

/** 按请求方法分发 mock:GET 返列表,其余返默认成功。每次 new Response(避免 body 被复读)。 */
function mockFetch(getBody: unknown, status = 200) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET')
      return new Response(JSON.stringify(getBody), { status })
    return new Response(JSON.stringify({ username: 'x', phone: '', disabled: false, is_admin: false }), { status: 200 })
  })
}

describe('AdminUsers 用户管理页', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('挂载后渲染用户列表(用户名 + 手机号)', async () => {
    vi.stubGlobal('fetch', mockFetch(USERS))
    renderAdmin()

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(await screen.findByText('bob')).toBeInTheDocument()
  })

  it('提交新建表单 → POST /api/admin/users 带 username/password/phone', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify(USERS), { status: 200 })
      return new Response(
        JSON.stringify({ username: 'carol', phone: '137', disabled: false, is_admin: false }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAdmin()
    await screen.findByText('alice')

    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'carol' } })
    fireEvent.change(screen.getByLabelText(/手机号/), { target: { value: '137000' } })
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'carolpw' } })
    fireEvent.click(screen.getByRole('button', { name: /新建用户/ }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(String(post![1]!.body)).toContain('carol')
      expect(String(post![1]!.body)).toContain('carolpw')
    })
  })

  it('点击禁用按钮 → PATCH 该用户 disabled:true', async () => {
    const fetchMock = mockFetch(USERS)
    vi.stubGlobal('fetch', fetchMock)
    renderAdmin()
    await screen.findByText('alice')

    const row = screen.getByText('alice').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /禁用/ }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, init]) => init?.method === 'PATCH' && String(u).includes('alice'),
      )
      expect(patch).toBeTruthy()
      expect(String(patch![1]!.body)).toContain('"disabled":true')
    })
  })

  it('编辑某行手机号并保存 → PATCH 新手机号', async () => {
    const fetchMock = mockFetch(USERS)
    vi.stubGlobal('fetch', fetchMock)
    renderAdmin()
    await screen.findByText('alice')

    const row = screen.getByText('alice').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /编辑/ }))
    fireEvent.change(within(row).getByLabelText(/手机号/), { target: { value: '137000' } })
    fireEvent.click(within(row).getByRole('button', { name: /保存/ }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, init]) => init?.method === 'PATCH' && String(u).includes('alice'),
      )
      expect(patch).toBeTruthy()
      expect(String(patch![1]!.body)).toContain('137000')
    })
  })

  it('删除按钮(confirm 后)→ DELETE 该用户', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify(USERS), { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAdmin()
    await screen.findByText('alice')

    const row = screen.getByText('alice').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /删除/ }))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([u, init]) => init?.method === 'DELETE' && String(u).includes('alice'),
      )
      expect(del).toBeTruthy()
    })
  })

  it('GET 返 403(非管理员)→ 跳首页', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: '需要管理员权限' }), { status: 403 }),
      ),
    )
    renderAdmin()

    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
  })
})
