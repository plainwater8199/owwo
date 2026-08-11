"""FastAPI 入口。

T1:/health。T4:登录流程 —— POST /api/login 设会话、GET /api/me 读登录态。
会话用 Starlette SessionMiddleware(itsdangerous 签名 cookie),只存用户名;
真正的用户鉴权在 T5(Caddy forward_auth)前置到 Hermes。
"""
import os

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from app.users import get_user, verify_password

app = FastAPI()

# 会话签名密钥:生产必须经环境变量设一个高熵随机值,默认值仅供本地开发。
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("OWWO_SECRET_KEY", "dev-insecure-change-me"),
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
