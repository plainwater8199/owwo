# Caddy 作为反向代理与鉴权网关

公开首页、登录 API 与受保护的 Hermes Dashboard 三者由 **Caddy** 统一接入:Caddy 终止 TLS、按路径分流——公开路径直接服务 React 静态文件或转给 FastAPI,`/hermes/*` 经 `forward_auth` 子请求 FastAPI 的 `/auth-check` 校验 session cookie 后才反代到绑定在内部网络的 Hermes Dashboard(:9119)。

## 为什么不让 FastAPI 自己反代

Hermes Dashboard 内嵌 PTY 终端,走 **WebSocket**(`/api/pty`)。FastAPI(Starlette)手写 WebSocket 代理既复杂又低效,且让 API 服务兼当反代会混淆职责。Caddy 原生支持 WebSocket 反代与 `forward_auth` 鉴权网关,且自动管理 HTTPS,配置极简。nginx + `auth_request` 是等价的老派方案,但配置更重、HTTPS 需自行 certbot,故不选。

## 部署

docker-compose 三服务同处一个内部网络,仅 Caddy 对外暴露 80/443:`caddy`(网关)、`fastapi`(登录/鉴权 API + SQLite)、`hermes`(`nousresearch/hermes-agent`,Dashboard 仅内部可达,不发布公网端口)。
