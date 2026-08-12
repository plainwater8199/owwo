"""T2:管理员手动创建用户 —— 用户模型 + argon2 + SQLite 的行为测试。

Seam(只经此边界测):app.users 的 create_user / get_user / verify_password。
不戳 DB 内部、不关心 SQL。
"""
import sqlite3

import pytest

from app.users import (
    UsernameExists,
    create_user,
    delete_user,
    get_user,
    list_users,
    update_user,
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


def test_create_user_with_optional_fields_round_trips(monkeypatch, tmp_path):
    """create_user 可选 phone/is_admin 落库后 get_user 回读一致。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    user = create_user("bob", "pw", phone="13800001111", is_admin=True)

    assert user.phone == "13800001111"
    assert user.is_admin is True
    assert user.disabled is False
    fetched = get_user("bob")
    assert fetched is not None
    assert fetched.phone == "13800001111"
    assert fetched.is_admin is True
    assert fetched.disabled is False


def test_create_user_defaults_for_new_fields(monkeypatch, tmp_path):
    """不传新字段时走默认值(phone='', disabled=False, is_admin=False)。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    create_user("alice", "s3cret")

    fetched = get_user("alice")
    assert fetched is not None
    assert fetched.phone == ""
    assert fetched.disabled is False
    assert fetched.is_admin is False


def test_legacy_db_migrated_with_defaults(monkeypatch, tmp_path):
    """旧 schema(只有 username+password_hash)的库,_connect 自动幂等补列,旧行得新字段默认值。"""
    db = tmp_path / "legacy.db"
    legacy = sqlite3.connect(db)
    legacy.execute(
        "CREATE TABLE users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL)"
    )
    legacy.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        ("olduser", "somehash"),
    )
    legacy.commit()
    legacy.close()

    monkeypatch.setenv("OWWO_DB_PATH", str(db))
    fetched = get_user("olduser")  # 触发 _connect 的幂等迁移
    assert fetched is not None
    assert fetched.username == "olduser"
    assert fetched.password_hash == "somehash"
    assert fetched.phone == ""
    assert fetched.disabled is False
    assert fetched.is_admin is False


def test_list_users_returns_all_created(monkeypatch, tmp_path):
    """list_users 返回所有已创建用户(含字段回读)。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    create_user("alice", "pw")
    create_user("bob", "pw", phone="13800001111")

    users = list_users()
    names = {u.username for u in users}
    assert names == {"alice", "bob"}


def test_update_user_phone_changes_only_phone(monkeypatch, tmp_path):
    """update_user 传 phone 只改 phone,hash 不变。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    create_user("alice", "pw", phone="111")
    old_hash = get_user("alice").password_hash

    updated = update_user("alice", phone="222")

    assert updated.phone == "222"
    after = get_user("alice")
    assert after.phone == "222"
    assert after.password_hash == old_hash  # 未传 password → hash 不变


def test_update_user_password_rehashes(monkeypatch, tmp_path):
    """update_user 传 password → 重 hash,新密码可验,旧密码失效。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    create_user("alice", "oldpw")

    update_user("alice", password="newpw")

    after = get_user("alice")
    assert verify_password(after.password_hash, "newpw") is True
    assert verify_password(after.password_hash, "oldpw") is False


def test_update_user_disabled_toggle(monkeypatch, tmp_path):
    """update_user 传 disabled 能禁用/启用(None=不改,True/False=改成该值)。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    create_user("alice", "pw")

    update_user("alice", disabled=True)
    assert get_user("alice").disabled is True
    update_user("alice", disabled=False)
    assert get_user("alice").disabled is False


def test_update_nonexistent_user_raises(monkeypatch, tmp_path):
    """update_user 目标不存在 → KeyError(便于路由层转 404)。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    with pytest.raises(KeyError):
        update_user("ghost", phone="x")


def test_delete_user_returns_true_then_false(monkeypatch, tmp_path):
    """delete_user 删存在返 True,删不存在返 False(幂等友好)。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))
    create_user("alice", "pw")

    assert delete_user("alice") is True
    assert get_user("alice") is None
    assert delete_user("alice") is False
