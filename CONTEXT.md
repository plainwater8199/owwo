# owwo

一个网站:公开首页介绍多智能体协作;用户登录后访问共享的 Hermes 与 DeepSeek Harness 两个 agent 入口。

## Language

**Hermes**:
本项目集成的 AI agent —— 即 Hermes Agent（Nous Research 的开源、自托管 AI agent），具备持久记忆与多智能体协作能力，是用户登录后实际使用的核心系统。有三个前端共用同一 runtime(同一份 config/sessions/skills):CLI、Dashboard、Desktop App。
_Avoid_: the agent、AI 助手

**Dashboard**:
Hermes 自带的 Web 前端,浏览器直接访问;本项目用户登录后用的就是它。
_Avoid_: 网页客户端、web UI

**Desktop App**:
Hermes 的 Electron 桌面前端,设计上装在使用者自己带显示器的电脑上,可远程连接服务器上的 agent。本项目不采用,用户一律经 Dashboard 访问。
_Avoid_: 客户端(泛称,曾引发歧义)

**DeepSeek Harness(dsh)**:
本项目集成的第二个 agent(DeepSeek 开源的 TypeScript/Node agent harness),与 Hermes 并列的独立入口,Web UI 自身无鉴权,与 Dashboard 一样靠 nginx `auth_request` 挡在登录之后(https://deepseek.owwo.cn)。与 Hermes 同为全员共享单实例;但在 OS 层与 Hermes 完全隔离——独立用户 `deepseek`、独立工作区 `~deepseek/workspace`,互不可读对方家目录。Node 二进制放在 `/opt` 共享(工具共享,数据不共享)。
_Avoid_: deepseek harness 的 web 页面、dsh web

**用户**:
完成注册与登录、从而获得访问 Hermes 与 DeepSeek Harness 授权的人。所有用户共享同一个 Hermes 实例(以及同一个 dsh 实例)，彼此不做数据隔离。
_Avoid_: 账号、客户

**管理员**:
拥有在系统中手动创建用户账号权限的用户。本系统不开放注册,管理员手动创建是用户准入的唯一入口(见 ADR-0001)。管理员由 `is_admin` 字段标识;默认管理员 `water` 由后端启动时自动创建。
_Avoid_: 超管、root

**手机号**:
用户可选的联系字段,由管理员在用户管理页维护。v1 不做格式强校验(仅去首尾空格),完整校验延后。
_Avoid_: 电话、mobile

**禁用**:
用户的一种状态。被禁用的用户无法登录(密码正确也返回 403);已登录的禁用用户下次经 /auth-check 访问 Hermes 时会被踢回登录页(其已开的 WebSocket 持续到刷新/重连)。管理员在用户管理页切换该状态。
_Avoid_: 封禁、冻结、block
