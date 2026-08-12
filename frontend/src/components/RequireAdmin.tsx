import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

type Me = { username: string; is_admin: boolean } | null

/**
 * 路由守卫。挂载读 /api/me:仅当当前用户是启用管理员时渲染子内容,
 * 否则重定向首页(非管理员不应看到用户管理页)。
 * 与后端 require_admin 双保险:URL 直接访问也被拦。
 */
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'deny'>('loading')

  useEffect(() => {
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me) => setState(data?.is_admin ? 'ok' : 'deny'))
      .catch(() => setState('deny'))
  }, [])

  if (state === 'loading') return <div className="min-h-screen bg-slate-50" />
  if (state === 'deny') return <Navigate to="/" replace />
  return <>{children}</>
}
