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
