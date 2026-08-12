"""用户模型与创建逻辑(裸 sqlite3 + argon2)。

Seam:create_user / get_user / verify_password。不开放注册,由管理员手动创建
(见 ADR-0001 / CONTEXT.md 的「管理员」)。
"""
from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_ph = PasswordHasher()


@dataclass
class User:
    username: str
    password_hash: str
    phone: str = ""
    disabled: bool = False
    is_admin: bool = False


class UsernameExists(Exception):
    """用户名已存在(管理员尝试重复创建时抛出)。"""


# 旧库(只有 username+password_hash 两列)幂等补列用的 DDL。
# SQLite 不支持 ADD COLUMN IF NOT EXISTS,靠 try/except OperationalError 判定列已存在。
_LEGACY_COLUMN_DDLS = [
    "ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
]


def _connect() -> sqlite3.Connection:
    """每次读 OWWO_DB_PATH(默认 owwo.db),首次自动建表;旧库幂等补列。"""
    db_path = os.environ.get("OWWO_DB_PATH", "owwo.db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users ("
        "username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, "
        "phone TEXT NOT NULL DEFAULT '', "
        "disabled INTEGER NOT NULL DEFAULT 0, "
        "is_admin INTEGER NOT NULL DEFAULT 0)"
    )
    # CREATE TABLE IF NOT EXISTS 对已存在的旧表是 no-op,需显式补列
    for ddl in _LEGACY_COLUMN_DDLS:
        try:
            conn.execute(ddl)
        except sqlite3.OperationalError:
            pass  # 列已存在
    conn.commit()
    return conn


def create_user(
    username: str,
    password: str,
    *,
    phone: str = "",
    is_admin: bool = False,
    disabled: bool = False,
) -> User:
    password_hash = _ph.hash(password)
    conn = _connect()
    try:
        try:
            conn.execute(
                "INSERT INTO users (username, password_hash, phone, disabled, is_admin)"
                " VALUES (?, ?, ?, ?, ?)",
                (username, password_hash, phone, int(disabled), int(is_admin)),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise UsernameExists(username) from exc
    finally:
        conn.close()
    return User(
        username=username,
        password_hash=password_hash,
        phone=phone,
        disabled=disabled,
        is_admin=is_admin,
    )


def get_user(username: str) -> User | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT username, password_hash, phone, disabled, is_admin"
            " FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return User(
        username=row[0],
        password_hash=row[1],
        phone=row[2],
        disabled=bool(row[3]),
        is_admin=bool(row[4]),
    )


def list_users() -> list[User]:
    """返回全部用户(按用户名排序,供管理员列表页)。"""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT username, password_hash, phone, disabled, is_admin"
            " FROM users ORDER BY username"
        ).fetchall()
    finally:
        conn.close()
    return [
        User(
            username=r[0],
            password_hash=r[1],
            phone=r[2],
            disabled=bool(r[3]),
            is_admin=bool(r[4]),
        )
        for r in rows
    ]


def update_user(
    username: str,
    *,
    phone: str | None = None,
    password: str | None = None,
    disabled: bool | None = None,
    is_admin: bool | None = None,
) -> User:
    """更新用户。仅更新显式传入(非 None)的字段;password 非空才重 hash。

    None 表示「不改」,用于区分「改成空串/False」与「保持不变」。
    用户不存在抛 KeyError(供路由层转 404)。返回更新后的 User。
    """
    if get_user(username) is None:
        raise KeyError(username)

    sets: list[str] = []
    params: list[object] = []
    if phone is not None:
        sets.append("phone = ?")
        params.append(phone)
    if password is not None:
        sets.append("password_hash = ?")
        params.append(_ph.hash(password))
    if disabled is not None:
        sets.append("disabled = ?")
        params.append(int(disabled))
    if is_admin is not None:
        sets.append("is_admin = ?")
        params.append(int(is_admin))

    # 有字段要改才落库;全 None 时 no-op,直接回读当前值
    if sets:
        params.append(username)
        conn = _connect()
        try:
            conn.execute(
                f"UPDATE users SET {', '.join(sets)} WHERE username = ?",
                params,
            )
            conn.commit()
        finally:
            conn.close()

    updated = get_user(username)
    assert updated is not None  # 上面已确认存在;单进程 sqlite 下不会消失
    return updated


def delete_user(username: str) -> bool:
    """删除用户。存在并删除返 True;不存在返 False(幂等友好)。"""
    conn = _connect()
    try:
        cur = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        conn.commit()
        deleted = cur.rowcount > 0
    finally:
        conn.close()
    return deleted


def verify_password(password_hash: str, password: str) -> bool:
    try:
        _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    return True


# 默认管理员(启动 seed 用,见 seed_default_admin)。
_DEFAULT_ADMIN_USERNAME = "water"
_DEFAULT_ADMIN_PASSWORD = "water123"


def seed_default_admin() -> None:
    """启动时确保默认管理员存在(幂等)。

    存在则不动 —— 避免重启覆盖管理员改过的密码/手机号(计划已确认决策)。
    设 OWWO_DISABLE_SEED=1 可跳过(测试或自管账号场景)。
    """
    if os.environ.get("OWWO_DISABLE_SEED"):
        return
    if get_user(_DEFAULT_ADMIN_USERNAME) is not None:
        return
    create_user(_DEFAULT_ADMIN_USERNAME, _DEFAULT_ADMIN_PASSWORD, is_admin=True)
