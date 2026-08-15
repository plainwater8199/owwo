import { Link } from 'react-router-dom'
import { DEEPSEEK_URL, HERMES_URL } from '../lib/urls'

/**
 * me 三态:
 *  - {username, is_admin?}:已登录 → 「已登录:{username}」+(管理员额外显示「用户管理」)
 *    +「进入 Hermes」主按钮 +「进入 DeepSeek」次按钮
 *  - null:明确未登录(Home 查过 /api/me)→ 「登录」主按钮(Link 到 /login)
 *  - undefined:不关心登录态(AdminUsers,守卫已保证是管理员)→ 两个 agent 入口按钮
 * brandOnly(Login)→ 仅「owwo」wordmark,右侧不放任何 link,
 * 避免出现「登录」文字与登录表单提交按钮在按名查找时撞车。
 */
const PRIMARY_BTN =
  'inline-flex items-center justify-center bg-primary text-primary-fg font-bold uppercase tracking-[0.15em] px-4 h-9 text-sm shadow-[inset_1px_1px_0_0_#ffffff80,inset_-1px_-1px_0_0_#00000080] active:invert'
const GHOST_BTN =
  'inline-flex items-center justify-center border border-border px-4 h-9 text-sm text-fg-muted hover:bg-primary/10'

export default function TopBar({
  me,
  brandOnly = false,
}: {
  me?: { username: string; is_admin?: boolean } | null
  brandOnly?: boolean
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-canvas px-6">
      <span className="font-bold uppercase tracking-[0.05em] text-fg">owwo</span>
      {brandOnly ? null : (
        <div className="flex items-center gap-4">
          {me ? <span className="text-sm text-fg-muted">已登录:{me.username}</span> : null}
          {me?.is_admin ? (
            <Link to="/admin/users" className={GHOST_BTN}>
              用户管理
            </Link>
          ) : null}
          {me === null ? (
            <Link to="/login" className={PRIMARY_BTN}>
              登录
            </Link>
          ) : (
            <>
              <a href={HERMES_URL} className={PRIMARY_BTN}>
                进入 Hermes
              </a>
              <a href={DEEPSEEK_URL} className={GHOST_BTN}>
                进入 DeepSeek
              </a>
            </>
          )}
        </div>
      )}
    </header>
  )
}
