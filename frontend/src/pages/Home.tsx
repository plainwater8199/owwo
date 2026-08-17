import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import SiteFooter from '../components/SiteFooter'

type Me = { username: string; is_admin?: boolean } | null

/**
 * 公开首页。挂载后读 GET /api/me:已登录则显示用户名 + 进入 Hermes 入口,
 * 未登录则显示登录入口(指向 /login)。顶栏视觉语言与 Hermes 融合(深色 teal + 奶油主调)。
 */
export default function Home() {
  const [me, setMe] = useState<Me>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me) => setMe(data))
      .finally(() => setLoaded(true))
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <TopBar me={loaded ? me : null} />
      <main className="mx-auto max-w-3xl flex-1 px-8 py-20">
        <img src="/owwo-badge.svg" alt="OWWO" width="96" height="96" className="h-24 w-24" />
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-fg">多智能体协作</h1>
        <p className="mt-4 text-base text-fg-muted">
          owwo 让你登录后访问共享的 Hermes —— 一个具备持久记忆与多智能体协作能力的 AI agent。
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
