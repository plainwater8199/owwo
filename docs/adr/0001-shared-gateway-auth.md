# 共享门禁鉴权:后端全权鉴权 + 反向代理 loopback 上的 Hermes

Hermes Agent 的 Web Dashboard 在绑定非 loopback 地址时强制启用自带鉴权(未配置 provider 则拒绝启动),且不支持 trusted-header SSO(不解析 `Remote-User` / `X-Forwarded-User`);`--insecure` 自 2026-06 起已废弃为 no-op,无法绕过。

因此采用「共享门禁」:Hermes 绑定 `127.0.0.1`(不触发强制鉴权),由 FastAPI 后端全权负责用户登录与鉴权,登录通过后才反向代理到 Hermes。所有登录用户共享同一个 Hermes 实例,Hermes 内部不做 per-user 数据隔离。

## 放弃的备选

- **Self-hosted OIDC 单点登录**:要求把登录系统做成 OIDC Provider(或引入 Keycloak / Authentik),复杂度过高,超出「后端自管登录」的需求。
- **每用户独立 Profile**:实质是 N 个 Hermes 实例,需自管 profile 路由与每用户 `API_SERVER_KEY`,最复杂;当前无 per-user 隔离需求。

选共享门禁,是因为它最贴合「前后端分离、后端自管登录」的原始需求,且「Hermes 不支持 trusted-header」这一限制在本架构下无伤——后端压根不向 Hermes 传递身份,只做放行。

## Consequences

- 所有用户共享同一个 Hermes 实例,彼此的会话与记忆**不做隔离**——任何登录用户都能看到他人在 Hermes 里的数据。
- 因此用户准入必须受控:采用**管理员手动创建账号**(不开放注册),否则陌生人注册即可窥见所有人的 Hermes 数据。

## 实施记录(T5 落地)

本 ADR 的核心判断(loopback 豁免 gate、后端全权鉴权、登录后反代)在 T5 全部落地并经源码 + 运行时双重验证:

- **loopback 豁免 gate(源码确认)**:`hermes_cli/web_server.py` 的 `should_require_auth(host)` 仅当 host ∈ {127.0.0.1, localhost, ::1} 时返回 `False`;`--insecure` 自 2026-06 加固后是纯 no-op。绑 127.0.0.1 即 `auth_required=False`,middleware 直接 pass-through,无需任何 provider。
- **容器化下"loopback 反代"的实现**:容器间默认走 bridge 网络,Caddy 无法访问 hermes 容器的 loopback。解法是 `network_mode: "service:caddy"`——hermes 共享 caddy 的网络命名空间,于是 hermes 绑 127.0.0.1:9119,caddy 经 `reverse_proxy 127.0.0.1:9119` 即可触达。这是"绑 loopback + 反代"在容器编排下的等价物。
- **Hermes 无 trusted-header SSO(再次确认)**:四个内置 provider(basic / nous / self_hosted / drain)无一信任反代注入的身份头(`X-Forwarded-For` 仅审计 IP)。因此无法用 Caddy 注入身份让 Hermes 放行,只能靠 loopback 绕过其 gate。Hermes 侧裸奔,但只在 caddy 的 loopback 可达——外部任何请求必先过 Caddy forward_auth。
- **Hermes 校验 Host 头**:绑 127.0.0.1 时,Hermes 要求请求 Host 头 = 绑定 hostname(否则 `400 Invalid Host header`)。Caddy 默认保留原始 Host,故 reverse_proxy 需 `header_up Host 127.0.0.1` 改写。Hermes 的外部接入点已从 `hermes.localhost` 子域改为 `localhost:8081` 端口区分(见 ADR-0002「登录循环修复」:浏览器不把 `Domain=localhost` 的 cookie 发往 `*.localhost` 子域),Host 改写逻辑不变。
- **loopback 的软认证**:loopback 模式下根 HTML 注入 `__HERMES_SESSION_TOKEN__`(可用 `HERMES_DASHBOARD_SESSION_TOKEN` 固定),SPA 自取用调 API——用户无需在 dashboard 登录。该 token 只是 SPA 内部机制;真正的用户认证全在 owwo session + Caddy forward_auth。

## 实施记录(用户准入 Web 化)

用户准入从 CLI(`python -m app.cli create-user`)升级为 Web 管理页(`/admin/users`)。「不开放注册、管理员手动建号」的准入控制不变,只是入口从命令行变为浏览器:

- **is_admin 区分管理员**:users 表加 `is_admin` 字段。默认管理员 `water/water123` 由 FastAPI lifespan startup 幂等 seed(存在则不动,避免重启覆盖管理员改动;`OWWO_DISABLE_SEED=1` 可跳过)。只有管理员登录后才进入用户管理页(普通用户进首页),前端 `RequireAdmin` 守卫 + 后端 `require_admin` 依赖双保险。
- **CRUD 字段受限**:管理页只维护用户名/手机号/密码三项(见 CONTEXT.md)。用户名是只读 PK(改用户名会令旧 session 失效);手机号 v1 不强校验;密码由管理员重置(argon2 重 hash,无需验旧密码)。响应模型 `UserOut` 永不含 password_hash。
- **禁用经 /auth-check 对 Hermes 生效**:`disabled` 用户登录被拒(403);已登录的禁用用户其 owwo session 仍在,但 `/auth-check`(Caddy forward_auth 子请求)查 disabled 后走 302 → 下次点 Hermes 即被踢回登录页。Hermes 的 WebSocket 绕过 forward_auth(见 ADR-0002),故已开的 WS 持续到刷新/重连,可接受。
- **防锁死**:管理员不能删除/修改自己的账号(自保护)。唯一启用管理员即操作者自己,不能降级/禁用/删自己 → 系统永远至少保留一个启用管理员。
