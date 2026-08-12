"""FastAPI 入口。

T1:/health。T4:登录流程 —— POST /api/login 设会话、GET /api/me 读登录态。
T5:GET /auth-check 供 Caddy forward_auth 校验会话(未登录重定向回登录页,带 next 回跳 Hermes)。
会话用 Starlette SessionMiddleware(itsdangerous 签名 cookie),只存用户名。
"""
import os
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from app.users import get_user, verify_password

app = FastAPI()

# 会话签名密钥:生产必须经环境变量设一个高熵随机值,默认值仅供本地开发。
# domain:本地用端口区分(主站 :8080 / Hermes :8081),host-only cookie 跨端口共享,不设 domain;
# 生产若用子域名(主站 owwo.example.com / Hermes hermes.owwo.example.com),设 Domain=根域以跨子域。
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("OWWO_SECRET_KEY", "dev-insecure-change-me"),
    domain=os.environ.get("OWWO_SESSION_DOMAIN"),
)


class LoginRequest(BaseModel):
    username: str
    password: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/login")
def login(body: LoginRequest, request: Request) -> dict[str, str]:
    user = get_user(body.username)
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    # 会话只存用户名(ADR-0001:共享同一 Hermes,无单用户隔离)。
    request.session["username"] = user.username
    return {"username": user.username}


@app.get("/api/me")
def me(request: Request) -> dict[str, str]:
    username = request.session.get("username")
    if username is None:
        raise HTTPException(status_code=401, detail="未登录")
    return {"username": username}


@app.get("/auth-check")
def auth_check(request: Request):
    """Caddy forward_auth 子请求目标:有效 session 放行(200),否则 302 回登录页。

    Caddy 对 Hermes 端口的每个请求先打这里,带上原始 Cookie。
    返回 2xx → 放行;302 → Caddy 把重定向透传给浏览器 → 跳登录页(带 next 回跳)。
    """
    if request.session.get("username") is not None:
        return {"status": "ok"}
    public_url = os.environ.get("OWWO_PUBLIC_URL", "http://localhost:8080")
    hermes_url = os.environ.get("OWWO_HERMES_URL", "http://localhost:8081")
    return RedirectResponse(
        url=f"{public_url}/login?next={quote(hermes_url, safe='')}",
        status_code=302,
    )
