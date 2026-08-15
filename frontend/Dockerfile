# syntax=docker/dockerfile:1
# 前端生产镜像:node 构建静态产物 → nginx 托管(SPA)。
# 关键:VITE_HERMES_URL / VITE_DEEPSEEK_URL 必须在构建期注入(见 src/lib/urls.ts),
# 否则生产前端入口永远是 localhost 回退值 → Login.tsx 的 next 白名单
# (AGENT_ENTRY_URLS)永不匹配 → 登录后跳不进对应 agent。compose 的 build.args 负责传值。
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_HERMES_URL
ENV VITE_HERMES_URL=$VITE_HERMES_URL
ARG VITE_DEEPSEEK_URL
ENV VITE_DEEPSEEK_URL=$VITE_DEEPSEEK_URL
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
