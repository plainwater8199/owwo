"""FastAPI 入口。

T1:/health。T4:登录流程 —— POST /api/login 设会话、GET /api/me 读登录态。
T5:GET /auth-check 供 Caddy forward_auth 校验会话(未登录重定向回登录页,带 next 回跳 Hermes)。
会话用 Starlette SessionMiddleware(itsdangerous 签名 cookie),只存用户名。
"""
import os
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict
from starlette.middleware.sessions import SessionMiddleware

from app.users import (
    User,
    UsernameExists,
    create_user,
    delete_user,
    get_user,
    list_users,
    seed_default_admin,
    update_user,
    verify_password,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """startup:确保默认管理员 water 存在(幂等;见 users.seed_default_admin)。"""
    seed_default_admin()
    yield


app = FastAPI(lifespan=lifespan)

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


class UserCreate(BaseModel):
    username: str
    password: str
    phone: str = ""


class UserUpdate(BaseModel):
    """管理员编辑用户。全字段可选 —— 不传即不改(None 语义见 users.update_user)。"""

    phone: str | None = None
    password: str | None = None
    disabled: bool | None = None
    is_admin: bool | None = None


class UserOut(BaseModel):
    """对外用户视图 —— 永不含 password_hash(response_model 据此过滤)。"""

    model_config = ConfigDict(from_attributes=True)
    username: str
    phone: str
    disabled: bool
    is_admin: bool


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/login")
def login(body: LoginRequest, request: Request) -> dict[str, object]:
    user = get_user(body.username)
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.disabled:
        raise HTTPException(status_code=403, detail="账号已禁用")
    # 会话只存用户名(ADR-0001:共享同一 Hermes,无单用户隔离)。
    request.session["username"] = user.username
    # 返 is_admin 供前端分流:admin 无 next 时进用户管理页(见 Login.tsx)。
    return {"username": user.username, "is_admin": user.is_admin}


@app.get("/api/me")
def me(request: Request) -> dict[str, object]:
    username = request.session.get("username")
    if username is None:
        raise HTTPException(status_code=401, detail="未登录")
    user = get_user(username)
    # 会话指向已删除/已禁用用户 → 视同未登录(前端守卫据此跳走)。
    if user is None or user.disabled:
        raise HTTPException(status_code=401, detail="未登录")
    return {"username": user.username, "is_admin": user.is_admin}


@app.get("/auth-check")
def auth_check(request: Request):
    """Caddy forward_auth 子请求目标:有效 session 放行(200),否则 302 回登录页。

    Caddy 对 Hermes 端口的每个请求先打这里,带上原始 Cookie。
    返回 2xx → 放行;302 → Caddy 把重定向透传给浏览器 → 跳登录页(带 next 回跳)。
    有效 session 但用户已被禁用 → 同样 302,让「禁用」对共享 Hermes 生效
    (禁用用户下次点 Hermes 即被踢回登录)。
    """
    username = request.session.get("username")
    user = get_user(username) if username is not None else None
    if user is not None and not user.disabled:
        return {"status": "ok"}
    public_url = os.environ.get("OWWO_PUBLIC_URL", "http://localhost:8080")
    hermes_url = os.environ.get("OWWO_HERMES_URL", "http://localhost:8081")
    return RedirectResponse(
        url=f"{public_url}/login?next={quote(hermes_url, safe='')}",
        status_code=302,
    )


def require_admin(request: Request) -> User:
    """项目首个 Depends:校验当前登录用户是启用管理员,否则 401/403。

    返回当前 User,供路由做自保护(比较目标用户名 == current.username)。
    """
    username = request.session.get("username")
    if username is None:
        raise HTTPException(status_code=401, detail="未登录")
    user = get_user(username)
    if user is None or user.disabled:
        raise HTTPException(status_code=401, detail="未登录")
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


@app.get("/api/admin/users", response_model=list[UserOut])
def admin_list_users(_: User = Depends(require_admin)):
    return list_users()


@app.post("/api/admin/users", response_model=UserOut, status_code=201)
def admin_create_user(body: UserCreate, _: User = Depends(require_admin)):
    try:
        return create_user(body.username, body.password, phone=body.phone)
    except UsernameExists:
        raise HTTPException(status_code=400, detail="用户名已存在")


@app.patch("/api/admin/users/{username}", response_model=UserOut)
def admin_update_user(
    username: str,
    body: UserUpdate,
    current: User = Depends(require_admin),
):
    if get_user(username) is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 自保护:不能改自己(改密码/手机号/禁用/降级一律禁止)。防锁死由此保证 ——
    # 唯一启用管理员即操作者自己,不能降级/禁用/删自己 → 永远至少保留一个启用管理员。
    if username == current.username:
        raise HTTPException(status_code=403, detail="不能修改自己的账号")
    try:
        return update_user(
            username,
            phone=body.phone,
            password=body.password,
            disabled=body.disabled,
            is_admin=body.is_admin,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="用户不存在")


@app.delete("/api/admin/users/{username}", status_code=204)
def admin_delete_user(username: str, current: User = Depends(require_admin)):
    if username == current.username:
        raise HTTPException(status_code=403, detail="不能删除自己的账号")
    if not delete_user(username):
        raise HTTPException(status_code=404, detail="用户不存在")
    return None
