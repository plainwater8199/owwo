import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'

type User = {
  username: string
  phone: string
  disabled: boolean
  is_admin: boolean
}

const INPUT =
  'h-9 w-full border border-border bg-canvas/40 px-3 py-1 font-mono text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25'
const INPUT_SM =
  'h-8 w-full border border-border bg-canvas/40 px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25'
const BTN_PRIMARY =
  'inline-flex items-center justify-center bg-primary text-primary-fg font-bold uppercase tracking-[0.15em] px-3 h-8 text-xs shadow-[inset_1px_1px_0_0_#ffffff80,inset_-1px_-1px_0_0_#00000080] active:invert'
const BTN_GHOST =
  'inline-flex items-center justify-center border border-border px-3 h-8 text-xs text-fg-muted hover:bg-primary/10'
const BTN_DANGER =
  'inline-flex items-center justify-center border border-danger/40 px-3 h-8 text-xs text-danger hover:bg-danger/10'
const BADGE = 'inline-flex items-center px-2 py-0.5 text-xs font-medium tracking-[0.05em] border'

/** 状态徽章:启用=success / 禁用=warning(边框30%+底15%+字100% 公式)。 */
function StatusBadge({ disabled }: { disabled: boolean }) {
  return (
    <span
      className={`${BADGE} ${
        disabled
          ? 'border-warning/30 bg-warning/15 text-warning'
          : 'border-success/30 bg-success/15 text-success'
      }`}
    >
      {disabled ? '禁用' : '启用'}
    </span>
  )
}

/** 角色徽章:管理员=primary(奶油) / 普通=outline。 */
function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  return (
    <span
      className={`${BADGE} ${
        isAdmin ? 'border-primary/30 bg-primary/15 text-primary' : 'border-border text-fg-muted'
      }`}
    >
      {isAdmin ? '管理员' : '普通'}
    </span>
  )
}

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
    <div className="min-h-screen bg-canvas text-fg">
      <TopBar />
      <main className="mx-auto max-w-4xl space-y-6 px-8 py-10">
        <h1 className="text-sm font-bold uppercase tracking-[0.08em] text-fg">用户管理</h1>

        {error && (
          <p
            role="alert"
            className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}

        {/* 新建用户 */}
        <form onSubmit={handleCreate} className="space-y-3 border border-border bg-canvas/80 p-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-fg">新建用户</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="new-username" className="block text-sm text-fg-muted">
                用户名
              </label>
              <input
                id="new-username"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className={`mt-2 ${INPUT}`}
              />
            </div>
            <div>
              <label htmlFor="new-phone" className="block text-sm text-fg-muted">
                手机号
              </label>
              <input
                id="new-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className={`mt-2 ${INPUT}`}
              />
            </div>
            <div>
              <label htmlFor="new-password" className="block text-sm text-fg-muted">
                密码
              </label>
              <input
                id="new-password"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`mt-2 ${INPUT}`}
              />
            </div>
          </div>
          <button type="submit" className={BTN_PRIMARY}>
            新建用户
          </button>
        </form>

        {/* 用户列表 */}
        <div className="border border-border bg-canvas/80">
          <table className="min-w-full">
            <thead className="border-b border-border bg-canvas/60">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium tracking-[0.05em] text-fg-muted">
                  用户名
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium tracking-[0.05em] text-fg-muted">
                  手机号
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium tracking-[0.05em] text-fg-muted">
                  状态
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium tracking-[0.05em] text-fg-muted">
                  角色
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium tracking-[0.05em] text-fg-muted">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-faint">
              {!loaded ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-fg-muted">
                    加载中…
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.username} className="transition-colors hover:bg-primary/[0.03]">
                    <td className="px-4 py-2 text-sm text-fg">{u.username}</td>
                    <td className="px-4 py-2 text-sm text-fg-muted">
                      {editing === u.username ? (
                        <input
                          aria-label="手机号"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className={INPUT_SM}
                        />
                      ) : (
                        u.phone || '—'
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge disabled={u.disabled} />
                    </td>
                    <td className="px-4 py-2">
                      <RoleBadge isAdmin={u.is_admin} />
                    </td>
                    <td className="space-x-2 px-4 py-2">
                      {editing === u.username ? (
                        <>
                          <input
                            aria-label="新密码"
                            type="password"
                            placeholder="留空不改"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            className={`w-28 ${INPUT_SM}`}
                          />
                          <button type="button" onClick={() => handleSaveEdit(u)} className={BTN_PRIMARY}>
                            保存
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className={BTN_GHOST}>
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleDisabled(u)}
                            className={BTN_GHOST}
                          >
                            {u.disabled ? '启用' : '禁用'}
                          </button>
                          <button type="button" onClick={() => startEdit(u)} className={BTN_GHOST}>
                            编辑
                          </button>
                          <button type="button" onClick={() => handleDelete(u)} className={BTN_DANGER}>
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
