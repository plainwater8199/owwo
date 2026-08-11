import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

// Hermes 子域 URL(经 Caddy forward_auth 保护)。next 必须命中此前缀才放行外部跳转,
// 防止 open redirect(未登录被引到任意域)。
const HERMES_URL = import.meta.env.VITE_HERMES_URL ?? 'http://hermes.localhost:8080'

/**
 * 登录页。提交 → POST /api/login →
 *  - 有合法 ?next=(Caddy forward_auth 拦下未登录时带上的 Hermes 回跳地址)→ 跳该外部 URL
 *  - 否则 → 跳首页 /
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
      if (next && next.startsWith(HERMES_URL)) {
        window.location.href = next
        return
      }
      navigate('/')
      return
    }
    const body = await res.json().catch(() => null)
    setError(body?.detail ?? '登录失败')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow"
      >
        <h1 className="text-2xl font-bold text-slate-900">登录</h1>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-slate-700">
            用户名
          </label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            密码
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
        >
          登录
        </button>
      </form>
    </main>
  )
}
