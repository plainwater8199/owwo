"""T4:登录流程 —— POST /api/login 设会话、GET /api/me 读登录态。

Seam(只经此边界测):HTTP 接口(经 TestClient)。复用 T2 的 create_user 预置用户,
不戳 session 内部结构、不关心 argon2/SQL。
"""
from starlette.testclient import TestClient

from app.main import app
from app.users import create_user


def _fresh_db(monkeypatch, tmp_path) -> None:
    """每个测试隔离到独立的 SQLite 文件。"""
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))


def test_login_success_sets_session(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)
    create_user("alice", "s3cret")

    response = TestClient(app).post(
        "/api/login", json={"username": "alice", "password": "s3cret"}
    )

    assert response.status_code == 200
    assert response.json() == {"username": "alice"}
    # 签名会话 cookie 已下发(前端据此维持登录态)
    assert "session" in response.cookies


def test_login_wrong_password_returns_401(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)
    create_user("alice", "s3cret")

    response = TestClient(app).post(
        "/api/login", json={"username": "alice", "password": "wrong"}
    )

    assert response.status_code == 401


def test_login_unknown_user_returns_401(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)

    response = TestClient(app).post(
        "/api/login", json={"username": "ghost", "password": "whatever"}
    )

    assert response.status_code == 401


def test_me_without_session_returns_401(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)

    response = TestClient(app).get("/api/me")

    assert response.status_code == 401


def test_me_with_session_returns_username(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)
    create_user("alice", "s3cret")

    client = TestClient(app)
    client.post("/api/login", json={"username": "alice", "password": "s3cret"})

    response = client.get("/api/me")

    assert response.status_code == 200
    assert response.json() == {"username": "alice"}
