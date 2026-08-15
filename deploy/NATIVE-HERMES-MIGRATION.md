# Hermes Docker → 原生迁移切换手册(ADR-0003)

> 一次性切换手册:把生产的 Hermes 从 Docker 容器迁到宿主机原生安装,
> 同时删掉 Caddy 网关层(nginx 单层直连)。设计与动机见 `docs/adr/0003-hermes-native-nginx-single-layer.md`。
> 迁移完成后的日常更新见文末「日常更新」——那才是这次迁移的目的。
>
> 双轨回滚:验证不过就按「回滚」回到迁移前架构,数据基本无损。

## 迁移后架构

```
浏览器 → nginx(宿主机, 443 TLS + auth_request)
           ├─ owwo.cn         → fastapi 容器(127.0.0.1:8000)/ frontend 容器(127.0.0.1:8082)
           └─ hermes.owwo.cn  → /auth-check(fastapi)放行 → 原生 hermes dashboard(127.0.0.1:9119)
```

Caddy 容器、hermes 容器、Caddyfile.prod 全部退场;dev 环境不动(仍全容器 + dev Caddyfile)。

## 前置条件

- [ ] 服务器(下文以 `ssh owwo` = root@服务器 为例,部署目录 `/opt/owwo`),当前 Docker 栈健康运行
- [ ] 服务器已装 git / curl / xz(原生安装器依赖);CentOS/RHEL 系自带
- [ ] `uv` 不用手动装:安装器自带(或 `curl -LsSf https://astral.sh/uv/install.sh | bash`)

## 切换步骤(按序执行)

### 1. 代码侧改动上服务器

```bash
cd /opt/owwo
git fetch && git checkout feat/prod-deploy && git pull
```

本分支已含:新 `docker-compose.prod.yml`(无 caddy/hermes)、新 `deploy/nginx/owwo.conf.example`、
`deploy/systemd/hermes-dashboard.service`、后端 `/auth-check` 的 401 模式。

### 2. 建专用用户 + 装原生 Hermes

```bash
useradd -m hermes
loginctl enable-linger hermes        # 服务用户不登录也常驻(依赖 user@hermes.service)

sudo -u hermes bash -c 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'
```

安装器最后会打印 RHEL 系的手动依赖命令(Chromium 运行库等,`--with-deps` 不支持 RHEL)——**照抄执行**:

```bash
sudo dnf install -y <安装器打印的包列表>   # 大致是 nss at-spi2-atk libdrm 等 chromium 依赖
```

然后装 dashboard 前端 + PTY extras:

```bash
cd ~hermes/.hermes/hermes-agent
sudo -u hermes uv pip install -e ".[web,pty]"
sudo -u hermes ~/.local/bin/hermes --version    # 冒烟:能出版本号即装好
```

### 3. 数据迁移(hermes_data 卷 → 原生 HERMES_HOME)

```bash
# 容器还在跑,先停 hermes(避免迁移窗口内写数据)
cd /opt/owwo && docker compose -f docker-compose.prod.yml stop hermes

# 卷内 /opt/data 的内容拷到服务用户家目录(原生命名是 ~/.hermes)
docker run --rm -v owwo_hermes_data:/src -v /home/hermes/.hermes:/dst alpine \
  sh -c 'cp -a /src/. /dst/'
chown -R hermes:hermes /home/hermes/.hermes
```

> 若 `~/.hermes` 已被步骤 2 的安装器建出内容:只覆盖数据子目录(sessions/config/skills),
> 别把安装器生成的运行时文件盖掉。拿不准就先 `ls ~hermes/.hermes` 对一眼。

### 4. systemd 单元:gateway + dashboard

```bash
# gateway(消息平台介入;官方安装器自带 systemd 集成与更新自重启)
sudo -u hermes XDG_RUNTIME_DIR=/run/user/$(id -u hermes) \
  ~/.local/bin/hermes gateway install

# dashboard(手写单元,见仓库 deploy/systemd/hermes-dashboard.service)
sudo tee /etc/hermes-dashboard.env >/dev/null <<'EOF'
HERMES_DASHBOARD=1
HERMES_DASHBOARD_HOST=127.0.0.1
HERMES_DASHBOARD_PORT=9119
HERMES_DASHBOARD_SESSION_TOKEN=<openssl rand -hex 32 的输出>
HERMES_DASHBOARD_PUBLIC_URL=https://hermes.owwo.cn
HERMES_DISABLE_LAZY_INSTALLS=1
EOF
sudo chmod 600 /etc/hermes-dashboard.env
sudo cp /opt/owwo/deploy/systemd/hermes-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-dashboard
```

> `.env` 里旧的 `HERMES_DASHBOARD_SESSION_TOKEN` 不再被 compose 引用;新值以
> `/etc/hermes-dashboard.env` 为准(可以沿用旧值,也可以换新的——反正是浏览器会话级自取)。

### 5. 验证原生侧(先不动 nginx,从服务器本地测)

```bash
sudo -u hermes curl -s http://127.0.0.1:9119/ | head -5     # dashboard HTML
sudo systemctl status hermes-dashboard --no-pager
sudo -u hermes journalctl --user-unit hermes-dashboard -n 50 2>/dev/null || sudo journalctl -u hermes-dashboard -n 50 --no-pager
```

⚠ **待验证项(决定性)**:原生 dashboard 是否认 `HERMES_DASHBOARD_SESSION_TOKEN`
(官方环境变量文档查无此名)。测 WS:

```bash
TOKEN=$(sudo grep ^HERMES_DASHBOARD_SESSION_TOKEN /etc/hermes-dashboard.env | cut -d= -f2)
curl -s -i --max-time 3 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://127.0.0.1:9119/api/pty?channel=diag&token=$TOKEN" | head -3
# 101 = 认;403/404 = 不认 → 查 dashboard 启动日志里 token 相关行,
#   或试 HERMES_DASHBOARD_BASIC_AUTH_SECRET;这一步不过就先回滚再研究,别硬切。
```

### 6. 收缩 Docker 栈 + 切 nginx

```bash
# ① Docker:下线整个旧栈(caddy/hermes 一并),再起新栈(fastapi/frontend 直发端口)
cd /opt/owwo
docker compose -f docker-compose.prod.yml --env-file .env down
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
# hermes_data 卷不删(回滚保险)

# ② nginx:换新模板(hermes.owwo.cn 从 8081→9119 单层直连;owwo.cn 从 8080→8000/8082)
sudo cp deploy/nginx/owwo.conf.example /etc/nginx/conf.d/owwo.conf
sudo nginx -t && sudo systemctl reload nginx
```

顺序注意:先 `down` 旧栈再 `up` 新栈,8080/8081 端口让位;nginx 模板里的新端口(8000/8082/9119)与旧栈无冲突,先后影响只是几分钟的服务窗口。

### 7. 端到端验证

```bash
# 主站(应 200)
curl -I https://owwo.cn/

# 未登录打 Hermes(应 302 跳 owwo.cn/login?next=…)
curl -I https://hermes.owwo.cn/

# 登录后带 cookie(应 200)
curl -sI https://owwo.cn/api/login -X POST -H 'Content-Type: application/json' \
  -d '{"username":"water","password":"<你的密码>"}' -c /tmp/ck
curl -I -b /tmp/ck https://hermes.owwo.cn/
```

浏览器端到端:登录 `https://owwo.cn` → 进 Hermes → **PTY 终端能打字(WS 通)** → 聊天能流式输出。
禁用语义抽测:管理页禁用一个测试用户 → 该用户刷新 Hermes 应被踢回登录页。

### 8. 收尾

- 观察一两天无异常后,清退旧资产(可选,想保留双轨更久就不动):
  ```bash
  docker volume rm owwo_hermes_data     # 数据已迁原生侧
  ```
- `.env` 里 `HERMES_DASHBOARD_SESSION_TOKEN` 一行可删(改由 /etc/hermes-dashboard.env 管)。

## 回滚(验证不过时)

```bash
cd /opt/owwo
# ① 代码退回迁移前提交(compose/caddy/nginx 模板全回来)
git log --oneline -5        # 找迁移提交的前一个
git checkout <迁移前提交> -- docker-compose.prod.yml Caddyfile.prod deploy/nginx/owwo.conf.example
# ② 停原生侧
sudo systemctl disable --now hermes-dashboard
sudo -u hermes XDG_RUNTIME_DIR=/run/user/$(id -u hermes) ~/.local/bin/hermes gateway stop 2>/dev/null
# ③ 恢复 Docker 栈(hermes_data 卷还在,数据回到迁移时点)
docker compose -f docker-compose.prod.yml --env-file .env down
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
# ④ nginx 退回旧模板
sudo nginx -t && sudo systemctl reload nginx
```

数据时效:迁移窗口内原生侧新产生的 sessions 会在回滚后消失(卷里只有迁移时点快照)。
验证窗口越短损失越小。

## 日常更新(迁移后)

```bash
sudo -u hermes hermes update --check   # 预览:会更新到什么
sudo -u hermes hermes update           # 快照 → git pull → 语法校验(失败自动回滚)→ 重装依赖 → 重启 gateway
```

- dashboard 单元不会自动重启,升级涉及 dashboard 的版本后手动
  `sudo systemctl restart hermes-dashboard`。
- 手动回退版本:`sudo -u hermes git -C ~hermes/.hermes/hermes-agent checkout vX.Y.Z && \
  sudo -u hermes uv pip install -e ".[all]" && sudo systemctl restart hermes-dashboard`
- 日志:`sudo journalctl -u hermes-dashboard -f`;gateway 日志在 `~hermes/.hermes/logs/`。
