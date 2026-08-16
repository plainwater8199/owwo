# DeepSeek Harness(dsh)部署手册

> 在生产服务器上部署第二个 agent 入口:DeepSeek Harness Web UI,
> 经 https://deepseek.owwo.cn 对外,鉴权与 Hermes 同款(nginx `auth_request`)。
> 架构位置见 CONTEXT.md「DeepSeek Harness(dsh)」与 ADR-0003 的网关模式。

## 架构与隔离

```
浏览器 → nginx(443 TLS + auth_request)
           └─ deepseek.owwo.cn → /auth-check 放行 → dsh web(127.0.0.1:3080, systemd, 用户 deepseek)
```

- **OS 隔离**:专用用户 `deepseek`;工作区 `/home/deepseek/workspace`。
  与 Hermes(用户 `hermes`)互不可读对方家目录(双方 home 均 0700)。
  用户要求「各自工作区、相互隔离」——两 agent 同为全体登录用户共享,但彼此的
  配置/凭据/数据不互通。
- **共享的只有工具**:`/opt/node-v26.7.0-glibc217`(glibc-217 变体,CentOS 7 能跑的
  Node 26,从 `~hermes/.hermes/node` 挪出,原位置留软链兼容 Hermes 自动发现)。
- **dsh 自身无鉴权**(dsh-host-webserver 只绑 loopback/0.0.0.0,无 TLS 无认证无 origin
  策略)→ 必须保持 loopback + nginx 门禁,千万别配 `--host 0.0.0.0`。

## 部署步骤(一次性)

前置:DNS `deepseek.owwo.cn` A 记录已指向服务器;`ssh owwo`(root)。

```bash
# 1. 专用用户 + 工作区
useradd -m deepseek          # CentOS 7 默认建 0700 home,即天然隔离
sudo -u deepseek mkdir -p ~deepseek/workspace

# 2. Node 挪共享区(hermes 侧留软链兼容 find_node_executable)
systemctl stop hermes-dashboard hermes-gateway   # 挪动期间别让 Hermes 用着
mv ~hermes/.hermes/node /opt/node-v26.7.0-glibc217
chmod -R a+rX /opt/node-v26.7.0-glibc217
ln -s /opt/node-v26.7.0-glibc217 ~hermes/.hermes/node
systemctl start hermes-gateway hermes-dashboard  # 回归:hermes chat 可用即可

# 3. deepseek 用户的 npm 环境(国内镜像,同 hermes 侧三件套)
sudo -u deepseek tee ~deepseek/.npmrc >/dev/null <<'EOF'
registry=https://registry.npmmirror.com
disturl=https://npmmirror.com/mirrors/node
EOF
# 若 install 报 gyp/python 错(海象运算符 SyntaxError):给 deepseek 也装 uv + python3.11,
#   .npmrc 加 python=/home/deepseek/.local/bin/python3.11(参照 NATIVE-HERMES-MIGRATION.md)

# 4. 安装 dsh(锁定版本 —— developer preview,破坏性变更多;npm i 默认拉 latest)
sudo -u deepseek env PATH=/opt/node-v26.7.0-glibc217/bin:$PATH HOME=/home/deepseek \
  npm install --prefix /home/deepseek/.dsh-app @deepseek-ai/dsh@<查 npm view 的最新版>

# 5. systemd 单元
touch /etc/deepseek-web.env && chmod 600 /etc/deepseek-web.env   # 可空,留作扩展
cp <repo>/deploy/systemd/deepseek-web.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now deepseek-web
curl -s http://127.0.0.1:3080/ | head -5    # 冒烟:出 HTML 即活
journalctl -u deepseek-web -n 50 --no-pager

# 6. 证书扩 SAN(DNS 已生效后)
certbot certificates                          # 先看现有签发方式
certbot --expand -d owwo.cn -d hermes.owwo.cn -d deepseek.owwo.cn

# 7. nginx 切流
cp <repo>/deploy/nginx/owwo.conf.example /etc/nginx/conf.d/owwo.conf
nginx -t && systemctl reload nginx

# 8. 前端按钮上线(本仓库 feat/prod-deploy 分支)
cd /home/water/workspace/owwo/owwo && git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build frontend
```

## 验证(端到端)

```bash
curl -I https://deepseek.owwo.cn/                                  # 未登录:302 → owwo.cn/login?next=…
# 登录拿 cookie 后:
curl -sI https://owwo.cn/api/login -X POST -H 'Content-Type: application/json' \
  -d '{"username":"water","password":"<密码>"}' -c /tmp/ck
curl -I -b /tmp/ck https://deepseek.owwo.cn/                       # 应 200
```

浏览器:登录 owwo.cn → 「进入 DeepSeek」→ 设置→模型,填 DeepSeek API key →
选择工作区(`/home/deepseek/workspace`)→ 发一条消息确认流式输出。

## 日常更新

```bash
npm view @deepseek-ai/dsh version   # 看新版本,changelog 评估后再动
sudo -u deepseek env PATH=/opt/node-v26.7.0-glibc217/bin:$PATH HOME=/home/deepseek \
  npm install --prefix /home/deepseek/.dsh-app @deepseek-ai/dsh@<版本>
sudo systemctl restart deepseek-web
```

- dsh 是 developer preview,升级前看 release note;出问题就把版本装回去再重启。
- API key / Web UI 内的配置存在 `~deepseek`(DSH_HOME/profiles),重装包不动它。

## 回滚

```bash
systemctl disable --now deepseek-web                  # 下线服务
# nginx:git checkout 本手册之前的 deploy/nginx/owwo.conf.example → 拷回 /etc/nginx/conf.d/
nginx -t && systemctl reload nginx
# 证书 SAN 多一个无妨(不撤回也不影响续期);node 在 /opt 不动(hermes 软链还指着它)
```

---

## 实施记录(2026-08-15 实际部署,与手册的偏差)

已上线并通过 E2E(未登录 302 / 登录 200 / 主站与 hermes 回归 / 线上 bundle 含按钮)。
版本锁定 `@deepseek-ai/dsh@0.1.0-rc.6`。CentOS 7 新坑(老坑见 NATIVE-HERMES-MIGRATION.md):

1. **npm 26 默认拦截依赖的 install 脚本**(install-scripts 安全特性),5 个包被拦:
   `npm install-scripts approve <pkg...>` 批准后 `npm rebuild`。
2. **koffi 预编译加载失败**(GLIBCXX 3.4.20)→ 源码编译要 **cmake**(yum 装的是 2.8):
   EPEL 装 `cmake3` + `ln -s /usr/bin/cmake3 /usr/local/bin/cmake`。
   EPEL 原始 metalink 慢,baseurl 改 `mirrors.aliyun.com/epel`。
3. **node-pty 源码编译**:devtoolset-11 + `npm_config_python`。deepseek 用户没有
   python3.11,uv 装(astral→GitHub)被墙超时 → 用 SCL 的 **rh-python38**
   (`/opt/rh/rh-python38/root/usr/bin/python3`,gyp 海象运算符 3.8 就认)。
4. **sharp:glibc 2.17 唯一可行路线 = 锁 0.32.6 + 手放预编译产物**(2026-08-16 已修复上线):
   - 根因:sharp ≥0.33 只发 @img 预编译,libvips 要 GLIBC_2.25/2.27(glibc 本体垫不了);
     dsh-attachment-local 顶层 import sharp 且 `attachments` 服务被 apiproxy 硬依赖
     (禁用插件行会让启动饿死,试过,死路)。
   - 解法:sharp **0.32.6** 时代的预编译是 glibc 2.17 基线(实测 libvips 8.14.2
     最高只要 GLIBC_2.17、GLIBCXX_3.4.15,系统原生满足,连 libstdcxx 都不用垫):
     ① `npm pkg set dependencies.sharp=0.32.6 overrides.sharp=0.32.6` + `npm install`;
     ② 从 npmmirror 镜像手动下载两个产物(安装脚本走 GitHub 会超时):
        - 绑定:`cdn.npmmirror.com/binaries/sharp/v0.32.6/sharp-v0.32.6-napi-v7-linux-x64.tar.gz`
          → 解出 `build/Release/sharp-linux-x64.node` 放 `node_modules/sharp/build/Release/`
          (绑定自带 RPATH `$ORIGIN/../../vendor/8.14.5/linux-x64/lib`)
        - libvips:`cdn.npmmirror.com/binaries/sharp-libvips/v8.14.2/libvips-8.14.2-linux-x64.tar.gz`
          → 解出 `lib/` 放 `node_modules/sharp/vendor/8.14.5/linux-x64/lib/`
          (⚠ 目录名必须是 **8.14.5**(0.32.6 的 RPATH/config 写死);8.14.2 的库 ABI
          同为 libvips-cpp.so.42,实测加载+渲染正常;镜像无正式 8.14.5 linux-x64 资产)
     ③ **删嵌套真包**:npm 会给 dsh-attachment-local(optional 依赖)在
        `node_modules/@deepseek-ai/dsh-attachment-local/node_modules/sharp` 装 0.35.3,
        Node 解析优先嵌套 → 必删;顺手删 `node_modules/@img`(0.35 的残留)。
     ④ 验证:`node -e 'sharp({create:{...}}).png().toBuffer()'` 出字节数即成。
   - GLIBCXX 兜底(其他原生模块如 koffi 用):conda-forge libstdcxx-ng 11.2.0 装在
     `/opt/libstdcxx`(glibc 2.17 基线),单元 `LD_LIBRARY_PATH=/opt/libstdcxx`。
5. **LE API 被墙**:certbot 连 `acme-v02.api.letsencrypt.org` 超时(8/12 还能签)。
   解法:本机起 mini HTTP CONNECT 代理 + `ssh -R 8123`,服务器
   `https_proxy=http://127.0.0.1:8123 certbot certonly --webroot ...` 一次过。
   **续期隐患**:certbot renew 走 cron 时若再被墙会失败(timer 自动重试),
   收到续期失败告警时用同法手工跑。
6. npm 26 的 `--prefix` 安装**不建顶层 `bin/`**,启动器在
   `node_modules/.bin/dsh`(单元 ExecStart 已按此写)。
7. dsh 首次启动在 `~/.dsh/profiles/web/` 自动初始化 profile(auto-init),
   会以 deepseek 用户跑 npm(走 ~/.npmrc 的 npmmirror,无碍)。
8. **trusted-host 栅栏(2026-08-16 修)**:dsh 的 client-connection 对 `/api/*` 做
   Host 校验,只放行 loopback;经域名反代(Host=deepseek.owwo.cn)时**页面能开、
   所有 API 一律 403**(「加载提供方目录失败: transport failure for /api/llm.providers」)。
   解法:单元 ExecStart 加 `--trusted-host deepseek.owwo.cn`(实现是裸 `host[:port]`
   字符串比较,DNS 名可用);Origin 走同源校验,浏览器视角本就同源,自然通过。
   nginx 侧不需要改写 Host。

### 日常更新(修订版)

```bash
npm view @deepseek-ai/dsh version
sudo -u deepseek env PATH=/opt/node-v26.7.0-glibc217/bin:$PATH HOME=/home/deepseek \
  npm install --prefix /home/deepseek/.dsh-app @deepseek-ai/dsh@<版本>
# 新装依赖若有原生模块:参照上面第 1-3 条(approve + rebuild + devtoolset/python 环境)
# ⚠ sharp 修复必须重做(实施记录第 4 条):npm install 会重置 node_modules/sharp——
#   重放绑定+vendor 产物、删嵌套真包、再验证渲染:
SHARP=/home/deepseek/.dsh-app/node_modules/sharp
sudo -u deepseek mkdir -p $SHARP/build/Release $SHARP/vendor/8.14.5/linux-x64
sudo -u deepseek cp /opt/dsh-prebuilt/sharp-linux-x64.node $SHARP/build/Release/          # 预下载存此,见下
sudo -u deepseek cp -a /opt/dsh-prebuilt/libvips-lib $SHARP/vendor/8.14.5/linux-x64/lib/
find /home/deepseek/.dsh-app/node_modules -mindepth 2 -type d -path "*node_modules/sharp" \
  ! -path "$SHARP" | xargs -r rm -rf
find /home/deepseek/.dsh-app/node_modules -maxdepth 4 -type d -path "*node_modules/@img" | xargs -r rm -rf
sudo systemctl restart deepseek-web
```

> 两个产物持久化在服务器 `/opt/dsh-prebuilt/`(绑定 .node + libvips lib/ 目录,
> root 所有 755),升级后从那里重放,不用再走镜像下载。
