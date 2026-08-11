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
