import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app import main

client = TestClient(main.app)


class _OkConn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a, **k):
        return None


def _db_up(monkeypatch):
    monkeypatch.setattr(main.engine, "connect", lambda: _OkConn())


def _db_down(monkeypatch):
    def boom():
        raise OperationalError("SELECT 1", {}, Exception("db down"))

    monkeypatch.setattr(main.engine, "connect", boom)


def _redis_up(monkeypatch):
    monkeypatch.setattr(main.redis_client, "ping", lambda: True)


def _redis_down(monkeypatch):
    def boom():
        raise redis.ConnectionError("redis down")

    monkeypatch.setattr(main.redis_client, "ping", boom)


@pytest.mark.parametrize(
    ("db_up", "redis_up"),
    [(True, True), (False, True), (True, False), (False, False)],
)
def test_health(monkeypatch, db_up, redis_up):
    (_db_up if db_up else _db_down)(monkeypatch)
    (_redis_up if redis_up else _redis_down)(monkeypatch)

    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "db": db_up, "redis": redis_up}
