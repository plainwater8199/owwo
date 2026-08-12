"""工单3:默认管理员 seed —— seed_default_admin 幂等 + app lifespan 集成。

Seam:users.seed_default_admin(纯函数幂等)+ HTTP TestClient 进出触发 lifespan startup。
不戳 DB 内部,只经公共函数 / app 生命周期观察。
"""
from starlette.testclient import TestClient

from app.main import app
from app.users import create_user, get_user, seed_default_admin, verify_password


def _fresh_db(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("OWWO_DB_PATH", str(tmp_path / "test.db"))


def test_seed_creates_water_admin(monkeypatch, tmp_path):
    """空库 seed → water 存在,is_admin=True,密码验证 water123。"""
    _fresh_db(monkeypatch, tmp_path)
    monkeypatch.delenv("OWWO_DISABLE_SEED", raising=False)

    seed_default_admin()

    water = get_user("water")
    assert water is not None
    assert water.is_admin is True
    assert verify_password(water.password_hash, "water123") is True


def test_seed_idempotent_existing_admin_not_overwritten(monkeypatch, tmp_path):
    """water 已存在(密码/手机号已被自定义)→ seed 不覆盖。防止重启覆盖管理员改动。"""
    _fresh_db(monkeypatch, tmp_path)
    monkeypatch.delenv("OWWO_DISABLE_SEED", raising=False)
    create_user("water", "custom-pw", phone="13900001234", is_admin=True)

    seed_default_admin()  # 不应改动已有 water

    water = get_user("water")
    assert water.phone == "13900001234"  # 自定义字段保留
    assert verify_password(water.password_hash, "custom-pw") is True
    assert verify_password(water.password_hash, "water123") is False  # 没被重置


def test_seed_respects_disable_env(monkeypatch, tmp_path):
    """OWWO_DISABLE_SEED=1 → seed 跳过,空库仍空。"""
    _fresh_db(monkeypatch, tmp_path)
    monkeypatch.setenv("OWWO_DISABLE_SEED", "1")

    seed_default_admin()

    assert get_user("water") is None


def test_lifespan_seeds_water_on_startup(monkeypatch, tmp_path):
    """app lifespan startup 触发 seed —— TestClient 进入 context 即建 water。"""
    _fresh_db(monkeypatch, tmp_path)
    monkeypatch.delenv("OWWO_DISABLE_SEED", raising=False)

    with TestClient(app):
        water = get_user("water")
        assert water is not None
        assert water.is_admin is True
