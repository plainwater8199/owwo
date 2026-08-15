/** 两个 agent 入口(生产:宿主机 nginx 443 + auth_request,见 ADR-0003 与 deploy/DEEPSEEK-HARNESS.md)。 */
export const HERMES_URL = import.meta.env.VITE_HERMES_URL ?? 'http://localhost:8081'
export const DEEPSEEK_URL = import.meta.env.VITE_DEEPSEEK_URL ?? 'http://localhost:3080'

/** 登录页 ?next= 回跳白名单:两个 agent 子域都在此列(未登录访问被 nginx 弹回登录页时带上)。 */
export const AGENT_ENTRY_URLS = [HERMES_URL, DEEPSEEK_URL]
