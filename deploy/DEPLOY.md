# owwo 生产部署清单(owwo.cn)

> 面向操作员的服务器从零部署指南。架构与设计原理见仓库 `CONTEXT.md` / `docs/adr/`,本清单只讲「怎么做」。

## 架构一句话

```
浏览器 (https://owwo.cn / https://hermes.owwo.cn)
  → 宿主机 nginx :443  (终结 TLS + 域名路由 + HSTS + auth_request 鉴权)
      ├─ owwo.cn        → fastapi 容器(127.0.0.1:8000)/ frontend 容器(127.0.0.1:8082)
      └─ hermes.owwo.cn → /auth-check(fastapi)→ 原生 hermes dashboard(127.0.0.1:9119)
```

**Hermes 原生跑在宿主机**(专用用户 `hermes`,systemd 托管),nginx 经 loopback 单层直连 + `auth_request` 鉴权——没有 Caddy 网关层(见 ADR-0003;ADR-0001 的共享门禁模型不变)。从 Docker 全容器栈迁到本架构的步骤见 `deploy/NATIVE-HERMES-MIGRATION.md`;本清单是从零部署的完整流程。

## 前置条件(逐项核对)

- [ ] 服务器已装:**nginx(宿主机原生,非 docker)** + **docker** + **docker compose 插件**(`docker compose version` 能出版本)+ **git/curl/xz**(Hermes 原生安装器依赖)
- [ ] DNS:`owwo.cn` 和 `hermes.owwo.cn` 的 A 记录都指向服务器公网 IP
  ```bash
  dig +short owwo.cn          # 应返回服务器 IP
  dig +short hermes.owwo.cn   # 应返回服务器 IP
  ```
- [ ] 防火墙:80 / 443 入站放行
- [ ] 服务器所在地区确认(国内 / 海外)—— 影响构建镜像源,见步骤 8 注

---

## 步骤(按序执行)

### 1. 拉代码

```bash
sudo mkdir -p /opt/owwo && sudo chown $USER /opt/owwo   # 部署目录(可改)
sudo mkdir owwo && sudo chown $USER owwo
cd /opt/owwo
git clone <仓库地址> .            # 或已有则 git fetch && git checkout feat/prod-deploy && git pull
git checkout feat/prod-deploy     # 部署配置在这个分支
```

> 确认这些文件存在:`docker-compose.prod.yml`、`frontend/Dockerfile`、`.env.example`、`deploy/nginx/owwo.conf.example`、`deploy/systemd/hermes-dashboard.service`、`deploy/NATIVE-HERMES-MIGRATION.md`。

### 2. 检查端口冲突

fastapi/frontend 容器要绑宿主机的 `127.0.0.1:8000` 和 `127.0.0.1:8082`,原生 Hermes dashboard 绑 `127.0.0.1:9119`:

```bash
sudo ss -tlnp | grep -E ':8000|:8082|:9119'    # 无输出 = 空闲
```

**若被占**:改 `docker-compose.prod.yml` 的端口绑定**同时**改 `deploy/nginx/owwo.conf.example` 里对应 `proxy_pass` 的端口,保持一致。

### 3. 配密钥(`.env`)

```bash
cp .env.example .env
openssl rand -hex 32    # 复制输出 → 粘到 .env 的 OWWO_SECRET_KEY=
```

确认 `OWWO_SECRET_KEY` 已填(compose 用 `${VAR:?}` 强制校验,空值会直接 fail 不启动)。
`HERMES_DASHBOARD_SESSION_TOKEN` 不走 compose —— 原生部署后由 `/etc/hermes-dashboard.env`
管理(见步骤 10)。

### 4. 数据目录

```bash
mkdir -p data backups
```

### 5. nginx 临时配置(只为签证书)

签证书需要 nginx 80 端口放行 ACME 挑战路径。**先放一个只含 80 段的临时配置**(443 段引用的证书此时还不存在,放完整配置会让 `nginx -t` 失败):

```bash
sudo tee /etc/nginx/conf.d/owwo.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name owwo.cn hermes.owwo.cn;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
EOF
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
```

### 6. 签 Let's Encrypt 证书

**单张 SAN 证书覆盖两个域名**(省心,续期只续一张):

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d owwo.cn -d hermes.owwo.cn \
  --email waterwang9999@163.com --agree-tos --no-eff-email
# 把 you@example.com 换成你的邮箱
```

成功后证书在 `/etc/letsencrypt/live/owwo.cn/`(以第一个域名命名目录)。

> **若你已用 acme.sh**:等效命令 `acme.sh --issue -d owwo.cn -d hermes.owwo.cn -w /var/www/certbot`,签发后把步骤 7 里的证书路径换成 acme.sh 的安装路径即可。

**配续期后自动 reload nginx**(certbot 由 systemd timer 自动续期,续完需 reload nginx 才生效):

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

### 7. nginx 完整配置(启用 443)

用仓库的完整模板覆盖临时配置,并按实际证书路径核对:

```bash
sudo cp deploy/nginx/owwo.conf.example /etc/nginx/conf.d/owwo.conf
# 核对/修改证书路径(若用 acme.sh 或证书目录不同):
sudo vi /etc/nginx/conf.d/owwo.conf
sudo nginx -t && sudo systemctl reload nginx
```

模板含:`map`(WS Connection 头映射)+ 80(ACME 放行 + 301)+ 443 owwo.cn(主站:/api 等转 fastapi、静态转 frontend)+ 443 hermes.owwo.cn(`auth_request` 鉴权 + WS 透传 + Host/Origin 改写 + 长超时 + HSTS)。

### 8. (海外服务器可选)切官方镜像源

仓库 Dockerfile 默认用国内镜像源(`backend/Dockerfile` 阿里云 PyPI、`frontend/Dockerfile` npmmirror)。
- **国内服务器**:保持现状,构建快。
- **海外服务器**:可切官方源避免绕远。`backend/Dockerfile` 删掉 `--index-url https://mirrors.aliyun.com/pypi/simple`;`frontend/Dockerfile` 删掉 `npm config set registry ...` 那行。

> 不影响运行时,只影响构建速度。拿不准就先按现状跑,慢再切。

### 9. 安装原生 Hermes(专用用户 + systemd)

按 `deploy/NATIVE-HERMES-MIGRATION.md` 的步骤 2、4、5 执行(建 `hermes` 用户 → install.sh → dnf Chromium 依赖 → `[web,pty]` extras → `hermes gateway install` + dashboard 单元)。从零部署没有旧数据,跳过其中的数据迁移步骤。

### 10. 构建并启动

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
sudo systemctl enable --now hermes-dashboard   # 若步骤 9 还没起
```

首次会构建 fastapi 和 frontend 镜像,耗时几分钟。看进度:

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=50
sudo journalctl -u hermes-dashboard -f
```

### 11. 验证

```bash
# 主站首页(应 200)
curl -I https://owwo.cn/

# Hermes 未登录访问(应 302 跳 owwo.cn/login?next=...)
curl -I https://hermes.owwo.cn/

# 登录后 cookie 域(应含 Domain=owwo.cn; SameSite=Lax; HttpOnly)
curl -sI https://owwo.cn/api/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"water","password":"water123"}' | grep -i set-cookie
```

**浏览器端到端(关键)**:打开 `https://owwo.cn` → 用 `water / water123` 登录 → **应自动跳到 `https://hermes.owwo.cn`**(Hermes 界面)→ Hermes 内终端 / 实时数据(WebSocket)能正常收发。

### 12. 改默认管理员密码(必做)

默认管理员 `water/water123` 是硬编码 seed。**部署后立刻登录 → 用户管理页改密码**。seed 幂等(已存在不动),改完密码不会被重启覆盖。

### 13. SQLite 定时备份

SQLite 是单文件,**不能用 `cp`(可能拷到写入中间态损坏)**,必须用 `.backup` API:

```bash
sudo crontab -e
# 加一行(每天 3:17 备份,保留 30 天):
17 3 * * * sqlite3 /opt/owwo/data/owwo.db ".backup '/opt/owwo/backups/owwo-$(date +\%F).db'" && find /opt/owwo/backups -name 'owwo-*.db' -mtime +30 -delete
```

升级前也手动备份一次:`sqlite3 data/owwo.db ".backup 'backups/pre-upgrade.db'"`。

---

## 排错

**登录后没跳 Hermes(停在首页 / 用户管理页)**
→ `VITE_HERMES_URL` 构建期没注入。检查 `frontend/Dockerfile` 有 `ARG VITE_HERMES_URL` + `ENV VITE_HERMES_URL=$VITE_HERMES_URL`,`docker-compose.prod.yml` 的 `frontend.build.args` 有 `VITE_HERMES_URL: https://hermes.owwo.cn`。改后必须 `--build` 重建前端镜像。本仓库配置已正确,若仍出错通常是没带 `--build` 或浏览器缓存(硬刷新)。

**Hermes 界面打不开 / 终端(WebSocket)不通**
→ 分两段查。① dashboard 本体:`sudo systemctl status hermes-dashboard`、`sudo -u hermes curl -s http://127.0.0.1:9119/ | head -3`(有 HTML = 原生侧正常)。② nginx 透传:检查 `/etc/nginx/conf.d/owwo.conf` 的 `hermes.owwo.cn` 段有 `proxy_set_header Upgrade $http_upgrade;` + `proxy_set_header Connection $owwo_connection_upgrade;` + `proxy_set_header Host 127.0.0.1;` + `proxy_set_header Origin "";` + `proxy_read_timeout 86400s;` + `proxy_http_version 1.1;`(模板已配)。`curl -I https://hermes.owwo.cn/` 未登录应 302(不是 502/500)。

**`hermes.owwo.cn` 启动 / 重启瞬间 502**
→ dashboard 加载 skills 慢,`hermes-dashboard` 单元起来但还没监听 9119。`sudo journalctl -u hermes-dashboard -f` 看到监听日志即恢复(单元已配 `TimeoutStartSec=180`)。

**未登录打 Hermes 返回 500 而不是 302**
→ `/auth-check` 的 nginx 模式没生效。确认 `owwo.conf.example` 的 `/_auth` 子请求带 `X-OWWO-Auth-Request 1` 头,且后端是迁移后代码(`/auth-check` 对该头回 401)。

**`docker compose up` 报 `OWWO_SECRET_KEY required`**
→ `.env` 没填或没传 `--env-file .env`。

**构建卡在 `npm ci` / `pip install`(海外服务器)**
→ 见步骤 8,切官方源。国内服务器偶尔卡是镜像源抖动,重跑 `docker compose ... up -d --build`。

**端口冲突(步骤 2 报 8000/8082/9119 被占)**
→ 见步骤 2,同时改 compose 端口绑定 + nginx upstream 两处(9119 是 Hermes dashboard 绑定,改 `HERMES_DASHBOARD_PORT` 并同步 nginx)。

---

## 更新(已部署后拉新代码)

```bash
cd /opt/owwo
git pull
sqlite3 data/owwo.db ".backup 'backups/pre-upgrade-$(date +%F).db'"   # 升级前备份
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

更新 Hermes 本体(原生部署,ADR-0003 的动机所在):

```bash
sudo -u hermes hermes update --check   # 预览
sudo -u hermes hermes update           # 快照 → pull → 校验(失败自动回滚)→ 重装依赖 → 重启 gateway
```

详见 `deploy/NATIVE-HERMES-MIGRATION.md`「日常更新」。

证书续期:certbot 由 systemd timer 自动跑,续期后经步骤 6 配的 `reload-nginx.sh` hook 自动 reload nginx(acme.sh 用自己的 `--reloadcmd`)。
