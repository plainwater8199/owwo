"""工单5:管理员 CRUD API —— require_admin 守卫 + 4 路由 + 自保护。

Seam:HTTP /api/admin/users(经 TestClient,带登录 session)。
复用工单2 的数据函数预置用户;不戳 DB。UserOut 永不含 password_hash。
"""
from starlette.testclient import TestClient

from app.main import app
from app.users import create_user


def _fresh_db(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))


def _login(client: TestClient, username: str, password: str) -> None:
    resp = client.post("/api/login", json={"username": username, "password": password})
    assert resp.status_code == 200


def test_admin_list_requires_auth(monkeypatch, tmp_path):
    """匿名访问 admin API → 401。"""
    _fresh_db(monkeypatch, tmp_path)
    response = TestClient(app).get("/api/admin/users")
    assert response.status_code == 401


def test_admin_list_requires_admin(monkeypatch, tmp_path):
    """普通用户登录访问 → 403。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("alice", "pw")
    client = TestClient(app)
    _login(client, "alice", "pw")
    response = client.get("/api/admin/users")
    assert response.status_code == 403


def test_admin_list_returns_users_without_password_hash(monkeypatch, tmp_path):
    """admin 登录 → GET 返列表,且绝不含 password_hash。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    create_user("alice", "pw", phone="13800001111")
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.get("/api/admin/users")

    assert response.status_code == 200
    users = response.json()
    names = {u["username"] for u in users}
    assert {"admin", "alice"} <= names
    assert all("password_hash" not in u for u in users)  # 永不泄露 hash


def test_admin_create_user(monkeypatch, tmp_path):
    """admin POST 新建用户 → 201,该用户随后能登录。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.post(
        "/api/admin/users",
        json={"username": "bob", "password": "bobpw", "phone": "139"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "bob"
    assert body["phone"] == "139"
    assert "password_hash" not in body
    # bob 能登录
    assert (
        TestClient(app)
        .post("/api/login", json={"username": "bob", "password": "bobpw"})
        .status_code
        == 200
    )


def test_admin_create_duplicate_returns_400(monkeypatch, tmp_path):
    """重复用户名 → 400。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    create_user("bob", "pw")
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.post(
        "/api/admin/users", json={"username": "bob", "password": "x"}
    )
    assert response.status_code == 400


def test_admin_patch_updates_phone(monkeypatch, tmp_path):
    """admin PATCH 改手机号 → 回读一致。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    create_user("bob", "pw")
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.patch("/api/admin/users/bob", json={"phone": "13700000000"})

    assert response.status_code == 200
    assert response.json()["phone"] == "13700000000"


def test_admin_patch_password_rehashes(monkeypatch, tmp_path):
    """admin PATCH 新密码 → 旧密码失效、新密码可登录。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    create_user("bob", "bobpw")
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.patch("/api/admin/users/bob", json={"password": "newpw"})

    assert response.status_code == 200
    assert (
        TestClient(app)
        .post("/api/login", json={"username": "bob", "password": "newpw"})
        .status_code
        == 200
    )
    assert (
        TestClient(app)
        .post("/api/login", json={"username": "bob", "password": "bobpw"})
        .status_code
        == 401
    )


def test_admin_patch_nonexistent_returns_404(monkeypatch, tmp_path):
    """PATCH 不存在用户 → 404。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.patch("/api/admin/users/ghost", json={"phone": "x"})

    assert response.status_code == 404


def test_admin_delete_user(monkeypatch, tmp_path):
    """admin DELETE → 204,列表中消失。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    create_user("bob", "pw")
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.delete("/api/admin/users/bob")

    assert response.status_code == 204
    names = {u["username"] for u in client.get("/api/admin/users").json()}
    assert "bob" not in names


def test_admin_cannot_delete_self(monkeypatch, tmp_path):
    """自保护:admin 不能删自己 → 403。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.delete("/api/admin/users/admin")

    assert response.status_code == 403


def test_admin_cannot_disable_self(monkeypatch, tmp_path):
    """自保护:admin 不能禁用自己 → 403。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.patch("/api/admin/users/admin", json={"disabled": True})

    assert response.status_code == 403


def test_admin_cannot_demote_last_admin(monkeypatch, tmp_path):
    """防锁死:唯一启用管理员降级自己 → 403(永远至少保留一个启用管理员)。"""
    _fresh_db(monkeypatch, tmp_path)
    create_user("admin", "pw", is_admin=True)
    client = TestClient(app)
    _login(client, "admin", "pw")

    response = client.patch("/api/admin/users/admin", json={"is_admin": False})

    assert response.status_code == 403
