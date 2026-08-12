"""T5:forward_auth 鉴权端点 /auth-check。

Seam(只经此边界测):HTTP /auth-check。Caddy forward_auth 对每个 hermes 子域请求
先打这个端点:带有效 owwo session → 200 放行;无 → 302 回主站登录页(带 next 回跳 Hermes)。
复用 T4 的 session 逻辑。
"""
from starlette.testclient import TestClient

from app.main import app
from app.users import create_user, update_user


def _fresh_db(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))


def test_auth_check_with_session_returns_200(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)
    create_user("alice", "s3cret")
    client = TestClient(app)
    client.post("/api/login", json={"username": "alice", "password": "s3cret"})

    response = client.get("/auth-check")

    assert response.status_code == 200


def test_auth_check_without_session_redirects_to_login(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)

    # follow_redirects=False:我们要断言重定向本身,而非跟随后的结果
    response = TestClient(app).get("/auth-check", follow_redirects=False)

    assert response.status_code == 302
    location = response.headers["location"]
    assert "/login" in location
    # next 指向 Hermes(登录后回跳)。next 经 quote(safe="") 编码,冒号 → %3A。
    assert "next=" in location
    assert "localhost%3A8081" in location


def test_auth_check_disabled_user_redirects_to_login(monkeypatch, tmp_path):
    """有 session 但用户已被禁用 → /auth-check 当作未登录(302 回登录)。

    让「禁用」对共享 Hermes 真正生效:禁用用户下次点 Hermes 即被踢回登录。
    """
    _fresh_db(monkeypatch, tmp_path)
    create_user("alice", "s3cret")
    client = TestClient(app)
    client.post("/api/login", json={"username": "alice", "password": "s3cret"})
    # 登录后才禁用 alice(模拟管理员禁用一个已登录用户)
    update_user("alice", disabled=True)

    response = client.get("/auth-check", follow_redirects=False)

    assert response.status_code == 302
