"""T2:管理员手动创建用户 —— 用户模型 + argon2 + SQLite 的行为测试。

Seam(只经此边界测):app.users 的 create_user / get_user / verify_password。
不戳 DB 内部、不关心 SQL。
"""
import pytest

from app.users import (
    UsernameExists,
    create_user,
    get_user,
    verify_password,
)


def test_create_user_persists_and_hashes_password(monkeypatch, tmp_path):
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))

    user = create_user("alice", "s3cret")

    assert user.username == "alice"
    fetched = get_user("alice")
    assert fetched is not None
    assert fetched.username == "alice"
    # 明文密码绝不落库
    assert fetched.password_hash != "s3cret"
    assert "s3cret" not in fetched.password_hash
    # argon2 能验证正确密码、拒绝错误密码
    assert verify_password(fetched.password_hash, "s3cret") is True
    assert verify_password(fetched.password_hash, "wrong") is False


def test_duplicate_username_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    create_user("alice", "pw1")
    with pytest.raises(UsernameExists):
        create_user("alice", "pw2")
