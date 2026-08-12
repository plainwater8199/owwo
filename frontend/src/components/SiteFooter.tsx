const ICP_URL = 'https://beian.miit.gov.cn/#/Integrated/index'

/**
 * 站点底部:站点介绍 + 版权 + ICP 备案(合规要求)。
 * 接入公开页(首页 / 登录页)底部;管理页是登录后内部页,不挂。
 *
 * 视觉沿用 Hermes 令牌:深色画布 + 奶油字 + 全直角 + 顶部分隔细边
 * (border-t 与 TopBar 的 border-b 对称)。内容集中在此,改一处全站生效。
 */
export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-canvas">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-8 py-5 text-sm text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <p className="text-fg-muted">
          <span className="font-bold text-fg">OWWO实验室</span> · 一个专注 AGENT 智能体自研学习空间
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="text-fg-subtle">© 2026 owwo.cn</span>
          <a
            href={ICP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-fg-muted transition-colors hover:text-fg"
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            蜀ICP备2023032311号
          </a>
        </div>
      </div>
    </footer>
  )
}
