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


class UsernameExists(Exception):
    """用户名已存在(管理员尝试重复创建时抛出)。"""


def _connect() -> sqlite3.Connection:
    """每次读 OWWO_DB_PATH(默认 owwo.db),首次自动建表。"""
    db_path = os.environ.get("OWWO_DB_PATH", "owwo.db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users"
        " (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL)"
    )
    conn.commit()
    return conn


def create_user(username: str, password: str) -> User:
    password_hash = _ph.hash(password)
    conn = _connect()
    try:
        try:
            conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise UsernameExists(username) from exc
    finally:
        conn.close()
    return User(username=username, password_hash=password_hash)


def get_user(username: str) -> User | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return User(username=row[0], password_hash=row[1])


def verify_password(password_hash: str, password: str) -> bool:
    try:
        _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    return True
