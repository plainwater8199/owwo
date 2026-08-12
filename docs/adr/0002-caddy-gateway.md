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
   - ~~**session cookie 跨子域**~~(⚠ 已废弃,见下文「登录循环修复」):曾设 `OWWO_SESSION_DOMAIN=localhost` 让 cookie 跨 `*.localhost` 子域,但浏览器对 localhost 有特殊处理,实测不生效,反而导致登录循环。

## 实施记录(登录循环修复,2026-08)

用户报告:浏览器登录主站后点「进入 Hermes」被弹回登录页,无限循环。根因与修复:

- **根因**:浏览器(Chrome/Safari/Firefox)对 `localhost` 有特殊处理——`Domain=localhost` 的 cookie 不发送到 `*.localhost` 子域(被降级为 host-only,仅匹配 `localhost` 本身)。于是 `hermes.localhost` 的请求不带 session,Caddy forward_auth 的 `/auth-check` 永远读不到 session → 302 回登录页 → 循环。此前 curl 冒烟能过,是因为 curl 的 cookie 域匹配比浏览器宽松,掩盖了问题(假绿)。
- **修复:弃子域,改端口区分。** Hermes 从 `hermes.localhost:8080` 改为 `localhost:8081`(与主站 `localhost:8080` 同 host、不同端口)。cookie 不再设 `Domain`(host-only,host=`localhost`),按 RFC 6265 域匹配**不比较端口**,故 host-only cookie 在 `localhost:8080`↔`localhost:8081` 间天然共享,`/auth-check` 能读到 session。
- **落地**:Caddyfile 的 `http://hermes.localhost` 块改为 `http://:81`(容器内听 81,宿主机 8081→81);docker-compose caddy 发布 `8081:81`、移除 `OWWO_SESSION_DOMAIN`、`OWWO_HERMES_URL=http://localhost:8081`;前端 `HERMES_URL` 默认值同步为 `http://localhost:8081`。Host 头改写(`header_up Host 127.0.0.1`)仍需要,逻辑不变。
- **验证**:curl 三连——`/health` 200;未登录访问 `:8081` → 302 回登录页(`next` 指向 `localhost:8081`);登录后带 cookie 访问 `:8081` → **200 放行**。Set-Cookie 确认无 `Domain=`(host-only)。WebSocket PTY 留浏览器实测。
- **生产**:端口区分是本地 dev 绕 localhost 特殊处理的手段,生产用真实域名(主站 `owwo.example.com` / Hermes `hermes.owwo.example.com`)并设 `Domain=.example.com` 即可跨子域——真实域名没有 localhost 的特殊行为。

## 实施记录(WebSocket 403 修复,2026-08)

用户报告:进入 Hermes 聊天 "websocket connection failed"。根因与修复:

- **根因**:Caddy `forward_auth` 在转发前会剥离 hop-by-hop 头(`Connection`、`Upgrade`)。WS 握手请求经 forward_auth 处理后 Upgrade 标记丢失,Hermes 收到的是普通 `GET /api/ws`(非握手) → FastAPI 的 `@app.websocket` 路由对非 Upgrade 请求返回 403。SPA 自带的 `?token=` 没问题(直连 Hermes 同 token 返回 101),纯粹是 forward_auth 破坏了握手。
- **诊断三步**:① 绕过 Caddy 直连 Hermes `127.0.0.1:9119` + token → 101(Hermes 正常);② 经 Caddy(有 forward_auth) + token → 403;③ 经 Caddy(临时去掉 forward_auth) + token → 101。锁定 forward_auth。
- **修复:WS 绕过 forward_auth**。Caddyfile 用 `@ws` matcher(`Connection: *Upgrade*` + `Upgrade: websocket`)匹配 WS 请求,`handle @ws` 直接 `reverse_proxy` 不经 forward_auth;`handle`(兜底)对非 WS 请求(HTML、REST)走 forward_auth + reverse_proxy。互斥的 `handle` 保证 WS 走第一条、其余走第二条。
- **安全性**:WS 不再过 owwo session 的 forward_auth,改由 Hermes 自身 `?token=` 认证。该 token 嵌在根 HTML 的 `__HERMES_SESSION_TOKEN__`,而根 HTML 仍受 forward_auth 保护 —— 只有过了 owwo 登录的浏览器才能拿到 token,故 WS 的访问控制与登录态等价。生产 `HERMES_DASHBOARD_SESSION_TOKEN` 必须换高熵随机值。
- **验证**:curl 三连 —— WS `?token=` → 101;`GET /` 无 cookie → 302 回登录页;`GET /` 有 cookie → 200。
- **坑**:本机 `caddy reload` 因 `admin off` 失效(走 admin API);改用 `docker compose restart caddy`,但会连带 restart hermes(`network_mode: service:caddy` 依赖 caddy 的网络命名空间),需等 `HERMES_DASHBOARD_READY` 才能测。
