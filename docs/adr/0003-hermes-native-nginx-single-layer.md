# Hermes 原生部署 + nginx 单层网关

状态:accepted(2026-08-15)
取代:[ADR-0002 Caddy 作为反向代理与鉴权网关](0002-caddy-gateway.md)——其「两层代理是必然」的结论在本方案下不再成立;ADR-0001 的共享门禁鉴权模型不变,仅执行者从 Caddy `forward_auth` 换成 nginx `auth_request`。

生产环境的 Hermes 改为在宿主机上**原生安装**(专用服务用户 `hermes`,systemd 托管),Dashboard 仍绑 `127.0.0.1:9119` 豁免 fail-closed auth gate;宿主机 nginx 直接经 loopback 反代并做 `auth_request → /auth-check` 鉴权,**删除 Caddy 网关层**。fastapi/frontend 仍走 Docker(fastapi 发布 `127.0.0.1:8000` 供 nginx 反代)。

## 动机

`hermes update` 一条命令完成快照→git pull→语法校验(失败自动回滚)→依赖更新→gateway 重启,而 Docker 部署的更新受国内 registry mirror(daocloud)缓存陈旧滚动 tag 之害(caddy:2 缓存在 v2.4.6 的前车之鉴,`:latest` 同样有风险),还得手动拉镜像、重建容器。

## 两层为何不再必然

ADR-0002 的两层结构根因是「hermes 容器要用 `network_mode: service:caddy` 共享 Caddy 网络命名空间才能绑 loopback,宿主机 nginx 进不去容器 netns」。Hermes 原生跑在宿主机上后,它的 loopback 就是 nginx 的 loopback,单层直连成立。Caddy 层附带的整类 WS-403 问题(forward_auth 剥 hop-by-hop 头、@ws matcher 大小写、Host 改写)随之消失——nginx 的 `auth_request` 是子请求机制,不修改原请求头。

## dev 不动

本地 dev 维持 Docker Compose 全容器栈,接受 dev/prod 分叉(dev 无原生 Hermes,更新场景只存在于 prod)。

## 回滚

Docker hermes 服务定义与 `hermes_data` 卷保留不删;原生验证失败时停 systemd 单元、恢复 compose 的 hermes 服务即可回到 ADR-0002 架构。
