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
