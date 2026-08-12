import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { HERMES_URL } from '../lib/hermes'

const INPUT =
  'mt-2 h-9 w-full border border-border bg-canvas/40 px-3 py-1 font-mono text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25'

/**
 * 登录页。提交 → POST /api/login →
 *  - 有合法 ?next=(Caddy forward_auth 拦下未登录时带上的 Hermes 回跳地址)→ 跳该外部 URL
 *  - 否则 → 管理员进用户管理页 / 普通用户进首页(见 CONTEXT.md「管理员」)
 * 失败显错。会话 cookie 由后端(Starlette SessionMiddleware)下发并签名。
 */
export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({}) as { is_admin?: boolean })
      if (next && next.startsWith(HERMES_URL)) {
        window.location.href = next
        return
      }
      navigate(body.is_admin ? '/admin/users' : '/')
      return
    }
    const errBody = await res.json().catch(() => null)
    setError(errBody?.detail ?? '登录失败')
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <TopBar brandOnly />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm space-y-5 border border-border bg-canvas/80 p-8"
        >
          <h1 className="text-sm font-bold uppercase tracking-[0.08em] text-fg">登录</h1>
          {error && (
            <p
              role="alert"
              className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
          <div>
            <label htmlFor="username" className="block text-sm text-fg-muted">
              用户名
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm text-fg-muted">
              密码
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT}
            />
          </div>
          <button
            type="submit"
            className="h-9 w-full bg-primary text-primary-fg font-bold uppercase tracking-[0.15em] shadow-[inset_1px_1px_0_0_#ffffff80,inset_-1px_-1px_0_0_#00000080] active:invert"
          >
            登录
          </button>
        </form>
      </main>
    </div>
  )
}
