/** Hermes dashboard 入口(经 Caddy forward_auth 保护,端口区分 localhost:8081,见 ADR-0001/0002)。 */
export const HERMES_URL = import.meta.env.VITE_HERMES_URL ?? 'http://localhost:8081'
