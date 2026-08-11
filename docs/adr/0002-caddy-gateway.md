# Caddy 作为反向代理与鉴权网关

公开首页、登录 API 与受保护的 Hermes Dashboard 三者由 **Caddy** 统一接入:Caddy 终止 TLS、按路径分流——公开路径直接服务 React 静态文件或转给 FastAPI,`/hermes/*` 经 `forward_auth` 子请求 FastAPI 的 `/auth-check` 校验 session cookie 后才反代到绑定在内部网络的 Hermes Dashboard(:9119)。

## 为什么不让 FastAPI 自己反代

Hermes Dashboard 内嵌 PTY 终端,走 **WebSocket**(`/api/pty`)。FastAPI(Starlette)手写 WebSocket 代理既复杂又低效,且让 API 服务兼当反代会混淆职责。Caddy 原生支持 WebSocket 反代与 `forward_auth` 鉴权网关,且自动管理 HTTPS,配置极简。nginx + `auth_request` 是等价的老派方案,但配置更重、HTTPS 需自行 certbot,故不选。

## 部署

docker-compose 三服务同处一个内部网络,仅 Caddy 对外暴露 80/443:`caddy`(网关)、`fastapi`(登录/鉴权 API + SQLite)、`hermes`(`nousresearch/hermes-agent`,Dashboard 仅内部可达,不发布公网端口)。

## 实施发现(T1 冒烟后补充,影响 T5)

T1 三服务已跑通冒烟(`/health` 经 Caddy→FastAPI 返回 200;`/hermes/` 经 Caddy 到达 Hermes)。但冒烟暴露两个 T5 必须处理的约束:

1. **子路径反代会路径错位。** T1 用 `handle_path /hermes/*` strip 前缀后转发,但 Hermes Dashboard 的 auth gate 用**绝对路径**重定向(`Location: /login?next=%2F`,无 `/hermes` 前缀),其静态资源同理。浏览器经 `/hermes/` 访问时,登录页/资源请求会落到 `/login`、`/assets/*`,被 Caddy 兜底转给 FastAPI → 404。结论:**T5 不能用子路径挂载 dashboard,应改用独立子域名**(如 `hermes.<domain>`),Caddy 按 host 反代到 `hermes:9119`,路径根对齐、无需 strip。

2. **端口 80 在本机被另一项目(Dify 的 `docker-nginx-1`)占用。** T1 临时把 Caddy 宿主机映射改到 `8080`(容器内仍听 80)。生产独立部署(或停掉 Dify)后改回 `80:80`。

3. **basic-auth provider 满足 gate,但不是用户鉴权。** 绑 `0.0.0.0` 触发 Hermes 的 fail-closed auth gate;T1 配 `HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD=internal/internal-dev-pw` 只是让 dashboard 肯启动的**内部占位**。真正的用户级鉴权仍由 Caddy `forward_auth`(T5)完成,且因 Hermes 不支持 trusted-header SSO,T5 可能需要自定义 provider(见 ADR-0001 的放弃方案)。

## 实施记录(T5 落地)

T5 按"子域名 + forward_auth"方向落地,并修正了上面的第 1、3 点:

1. **子域名方案确认(第 1 点的解)。** 改用 `hermes.localhost`(macOS `.localhost` 自动解析 127.0.0.1,无需改 hosts),Caddy 按 host 分流:`http://localhost` 服务主站,`http://hermes.localhost` 反代 Hermes。路径根对齐,无需 strip 前缀,Hermes 的绝对路径重定向(`/login`、`/assets/*`)在 `hermes.localhost` 下天然正确。

2. **forward_auth 实测工作。** `forward_auth fastapi:8000 { uri /auth-check }`:Caddy 对 hermes 子域的每个请求先打 fastapi `/auth-check`(带原始 Cookie);有效 owwo session → 2xx 放行 → `reverse_proxy 127.0.0.1:9119`;无 session → fastapi 返回 302 → Caddy 透传 → 浏览器跳 `localhost:8080/login?next=<hermes URL>`。

3. **第 3 点的最终解(无需自定义 provider)。** 不再让 Hermes 绑 0.0.0.0 + basic-auth 占位,而是 `network_mode: "service:caddy"` + 绑 `127.0.0.1` 直接豁免 Hermes 的 gate(见 ADR-0001 实施记录)。basic-auth 占位 env 已移除。

4. **两个必须的 Caddy/cookie 配置(冒烟踩到):**
   - **Host 改写**:Hermes 绑 127.0.0.1 时校验 Host 头 = 绑定 hostname,Caddy 默认保留原始 Host 会被 Hermes 以 400 拒绝。reverse_proxy 需 `header_up Host 127.0.0.1`。
   - **session cookie 跨子域**:owwo session cookie 需从主站 `localhost` 带到 `hermes.localhost` 子域,故 SessionMiddleware 设 `OWWO_SESSION_DOMAIN=localhost`(domain cookie 对所有 `*.localhost` 生效)。生产换真实父域。
