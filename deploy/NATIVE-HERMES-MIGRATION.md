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
- **CentOS 7(本机)更新后必须重建 dashboard 前端**(见下方实施记录 5):
  `sudo /usr/local/bin/hermes-web-build && sudo systemctl restart hermes-dashboard`
- 手动回退版本:`sudo -u hermes git -C ~hermes/.hermes/hermes-agent checkout vX.Y.Z && \
  sudo -u hermes env CFLAGS=-std=gnu99 ~hermes/.hermes/bin/uv pip install --python ~hermes/.hermes/hermes-agent/venv/bin/python -e '.[all]' && sudo systemctl restart hermes-dashboard`
- 日志:`sudo journalctl -u hermes-dashboard -f`;gateway 日志在 `~hermes/.hermes/logs/`。

---

## 实施记录(2026-08-15 实际切换,与手册的偏差)

已切换成功并通过全部验证(302/200/101/gateway 3 平台 weixin+webhook+email)。
**`HERMES_DASHBOARD_SESSION_TOKEN` 原生 dashboard 认可**(`hermes dashboard` 读该 env,
WS `?token=` 握手 101)——手册步骤 5 的待验证项已闭环。以下为 CentOS 7 实战坑:

1. **安装器必须在家目录跑**:`sudo -u hermes bash -c '...'` 继承 cwd=/root 时,
   uv 向上找 venv 会撞 `/root/.venv` 权限拒绝。必须先 `cd ~hermes`。
2. **nodejs.org 直连超时 + CentOS 7 glibc 2.17 跑不了官方 Node 26**:
   装 `--skip-browser --skip-computer-use --skip-setup`;node 下载失败只是优雅降级,
   不阻塞安装(烧 5 分钟 curl 超时后继续)。浏览器/WhatsApp 桥等 node 功能不可用——
   本机不需要。
3. **pillow 源码构建双坑**:新 pillow 只有 manylinux_2_28 wheel(glibc 2.28+),
   CentOS 7 退回 sdist;gcc 4.8 默认 gnu89 → 需 `yum install zlib-devel libjpeg-devel`
   (镜像还活着)+ `CFLAGS=-std=gnu99`。装完后手动补装全部依赖并建入口软链:
   ```bash
   cd ~hermes/.hermes/hermes-agent
   sudo -u hermes env CFLAGS=-std=gnu99 ~hermes/.hermes/bin/uv pip install \
     --python venv/bin/python -e '.[all]'
   sudo -u hermes ln -sf ~hermes/.hermes/hermes-agent/venv/bin/hermes ~hermes/.local/bin/hermes
   ```
4. **systemd 219 缺 user@.service 模板**(本机被裁剪),`--user` 单元装不了:
   gateway 改用系统级 `hermes gateway install --system --run-as-user hermes`(root 执行,
   服务文件 /etc/systemd/system/hermes-gateway.service,Unit 段的 StartLimitIntervalSec
   在 219 上报 Unknown lvalue 警告,无害)。dashboard 单元本来就是系统级,不受影响。
5. **dashboard 前端要构建 + stamp**:Docker 镜像里 web_dist 是预编译的,原生安装不含。
   `hermes dashboard` 检查 `hermes_cli/web_dist/` + `~/.hermes/web-ui-build-stamp.json`
   (web/ 源码内容哈希)。CentOS 7 无 node → **用现成 hermes Docker 镜像当构建器**
   (monorepo,须从仓库根 `npm install --workspace web`),已固化为
   `/usr/local/bin/hermes-web-build`(构建 + 写 stamp)。`hermes update` 改了 web 源码后
   必须重跑它,否则 dashboard 因哈希不匹配拒绝启动。
6. **数据迁移细节**:容器内 hermes 是 uid 10000,宿主 hermes 是 1000,拷完必须
   `chown -R hermes:hermes`。新 compose 已无 hermes 服务,停旧容器用
   `docker stop owwo-hermes-1`(不是 compose stop)。
7. **webhook 平台监听 `*:8644` 全接口**:Docker 时代在容器网内,原生后直接暴露宿主。
   本机 firewalld inactive 但云安全组已挡(外网 000 超时)。若安全组放行过 8644 需收回。
8. 杂项:老 curl 无 `--http1.1` 选项(默认本就是 1.1);git 1.8.3.1 但够用;
   nginx 模板一次通过 `nginx -t`。

## 实施记录补充(2026-08-15 晚:Dashboard 聊天修复)

切换后用户报「不能对话」。**根因:dashboard 的聊天(/chat 标签)是 PTY 里 spawn 的
TUI(基于 Node/Ink)跑的,node 是运行时依赖,不只是构建期**。缺 node 时 PTY 里只回一行
`Chat unavailable: npm not found`(journalctl 里搜 `Chat unavailable` 可见)。
镜像里不带 `hermes_cli/tui_dist/` 预编译产物,必须源码装。修复链(CentOS 7):

1. **兼容 Node**:官方 Node 26 二进制要 glibc 2.28,用 unofficial-builds 的
   `linux-x64-glibc-217` 变体(服务器直连超时,本机下载后 scp):
   ```bash
   # 本机: curl -LO https://unofficial-builds.nodejs.org/download/release/v26.7.0/node-v26.7.0-linux-x64-glibc-217.tar.xz && scp ... owwo:/tmp/
   # 服务器: tar xf ... && rm -rf ~hermes/.hermes/node && mv node-v26.7.0-* ~hermes/.hermes/node && chown -R hermes:hermes ~hermes/.hermes/node
   ```
   装在 `$HERMES_HOME/node` 是安装器的「Hermes-managed Node」标准位置,
   `find_node_executable()` 自动发现,无需改 PATH。
2. **TUI 依赖三连坑**(`npm install --workspaces`):
   - gyp 的 Python 代码用 `:=` 海象运算符,系统 python3 是 3.6.8 → 必须
     `npm_config_python=/home/hermes/.local/bin/python3.11`(uv 装的);
   - node-pty 1.1.0 源码编译要 `-std=gnu++20`,gcc 4.8 不行 → 加 aliyun SCL
     vault 源(`/etc/yum.repos.d/centos-sclo.repo`,
     `baseurl=https://mirrors.aliyun.com/centos/7/sclo/x86_64/rh/`)装
     devtoolset-11,PATH 前置 `/opt/rh/devtoolset-11/root/usr/bin`;
   - node-gyp 下 headers 走 unofficial-builds(超时)→
     `npm_config_disturl=https://npmmirror.com/mirrors/node`(headers 与 glibc 变体无关);
   - 还需 `yum install gcc-c++`(base 源)。
3. **持久化**(防 `hermes update` 后重装再踩):
   - `~hermes/.npmrc`:registry/python/disturl 三项(见上);
   - `/etc/hermes-dashboard.env` 首行 `PATH=/opt/rh/devtoolset-11/root/usr/bin:/home/hermes/.hermes/node/bin:...`
     ——dashboard spawn TUI/npm 时继承。
4. **验证**:PTY WS 连 20s,收到 29KB 终端帧(TUI 横幅渲染)、无 `Chat unavailable`;
   回归 302/200/101 全过。浏览器端建议用户实测打字对话。
