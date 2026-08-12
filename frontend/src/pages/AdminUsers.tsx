import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type User = {
  username: string
  phone: string
  disabled: boolean
  is_admin: boolean
}

const HERMES_URL = import.meta.env.VITE_HERMES_URL ?? 'http://localhost:8081'

/**
 * 管理员用户管理页。字段限用户名/手机号/密码(见 CONTEXT.md / ADR-0001):
 *  - 用户名是只读 PK(改用户名会令旧 session 失效,v1 不支持)
 *  - 手机号:v1 不强校验,仅 trim,延后
 *  - 密码:管理员重置无需验旧密码;编辑时留空不改
 * GET 403(非管理员绕过守卫直访)→ 回首页。
 */
export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  // 新建表单
  const [newUsername, setNewUsername] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPassword, setNewPassword] = useState('')

  // 行内编辑态:正在编辑的用户名 + 临时字段
  const [editing, setEditing] = useState<string | null>(null)
  const [editPhone, setEditPhone] = useState('')
  const [editPassword, setEditPassword] = useState('')

  async function load() {
    const res = await fetch('/api/admin/users')
    if (res.status === 403) {
      navigate('/')
      return
    }
    if (!res.ok) {
      setError('加载用户列表失败')
      setLoaded(true)
      return
    }
    setUsers(await res.json())
    setLoaded(true)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: newUsername.trim(),
        password: newPassword,
        phone: newPhone.trim(),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.detail ?? '新建失败')
      return
    }
    setNewUsername('')
    setNewPhone('')
    setNewPassword('')
    await load()
  }

  async function handleToggleDisabled(u: User) {
    setError('')
    const res = await fetch(`/api/admin/users/${u.username}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: !u.disabled }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.detail ?? '操作失败')
      return
    }
    await load()
  }

  function startEdit(u: User) {
    setEditing(u.username)
    setEditPhone(u.phone)
    setEditPassword('')
  }

  async function handleSaveEdit(u: User) {
    setError('')
    const patch: Record<string, unknown> = {}
    if (editPhone !== u.phone) patch.phone = editPhone.trim()
    if (editPassword) patch.password = editPassword
    const res = await fetch(`/api/admin/users/${u.username}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.detail ?? '保存失败')
      return
    }
    setEditing(null)
    await load()
  }

  async function handleDelete(u: User) {
    if (!window.confirm(`确认删除用户 ${u.username}?`)) return
    setError('')
    const res = await fetch(`/api/admin/users/${u.username}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.detail ?? '删除失败')
      return
    }
    await load()
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between px-8 py-4">
        <span className="text-xl font-semibold">用户管理</span>
        <a
          href={HERMES_URL}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
        >
          进入 Hermes
        </a>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-8 py-10">
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {/* 新建用户 */}
        <form onSubmit={handleCreate} className="space-y-3 rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold">新建用户</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="new-username" className="block text-sm font-medium text-slate-700">
                用户名
              </label>
              <input
                id="new-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="new-phone" className="block text-sm font-medium text-slate-700">
                手机号
              </label>
              <input
                id="new-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-slate-700">
                密码
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
          >
            新建用户
          </button>
        </form>

        {/* 用户列表 */}
        <div className="overflow-hidden rounded-lg bg-white shadow">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-sm font-medium text-slate-700">用户名</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-slate-700">手机号</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-slate-700">状态</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-slate-700">角色</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loaded ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    加载中…
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.username}>
                    <td className="px-4 py-2 text-sm">{u.username}</td>
                    <td className="px-4 py-2 text-sm">
                      {editing === u.username ? (
                        <input
                          aria-label="手机号"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="block w-full rounded-md border border-slate-300 px-2 py-1"
                        />
                      ) : (
                        u.phone || '—'
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm">{u.disabled ? '禁用' : '启用'}</td>
                    <td className="px-4 py-2 text-sm">{u.is_admin ? '管理员' : '普通'}</td>
                    <td className="space-x-2 px-4 py-2 text-sm">
                      {editing === u.username ? (
                        <>
                          <input
                            aria-label="新密码"
                            type="password"
                            placeholder="留空不改"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            className="rounded-md border border-slate-300 px-2 py-1"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(u)}
                            className="rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="rounded border border-slate-300 px-2 py-1"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleDisabled(u)}
                            className="rounded border border-slate-300 px-2 py-1"
                          >
                            {u.disabled ? '启用' : '禁用'}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(u)}
                            className="rounded border border-slate-300 px-2 py-1"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(u)}
                            className="rounded border border-red-300 px-2 py-1 text-red-600"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
