# owwo

一个网站:公开首页介绍多智能体协作;用户登录后访问共享的 Hermes。

## Language

**Hermes**:
本项目集成的 AI agent —— 即 Hermes Agent（Nous Research 的开源、自托管 AI agent），具备持久记忆与多智能体协作能力，是用户登录后实际使用的核心系统。
_Avoid_: the agent、AI 助手

**用户**:
完成注册与登录、从而获得访问 Hermes 授权的人。所有用户共享同一个 Hermes 实例，彼此不做数据隔离。
_Avoid_: 账号、客户

**管理员**:
拥有在系统中手动创建用户账号权限的用户。本系统不开放注册,管理员手动创建是用户准入的唯一入口(见 ADR-0001)。
_Avoid_: 超管、root
