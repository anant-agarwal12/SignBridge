from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.main import app

client = TestClient(app)
STATIC = Path(main.__file__).parent / "static"


def post(text, lang="asl"):
    return client.post("/fingerspell", json={"text": text, "lang": lang})


def test_uppercases_and_builds_urls():
    resp = post("hi", "isl")
    assert resp.status_code == 200
    assert resp.json() == {
        "lang": "isl",
        "letters": [
            {"char": "H", "clip_url": "/static/letters/isl/H.json"},
            {"char": "I", "clip_url": "/static/letters/isl/I.json"},
        ],
        "skipped": [],
    }


def test_case_insensitive():
    assert post("Hello").json()["letters"] == post("HELLO").json()["letters"]


def test_spaces_ignored_and_not_reported():
    body = post("a b\tc").json()
    assert [letter["char"] for letter in body["letters"]] == ["A", "B", "C"]
    assert body["skipped"] == []


def test_digits_and_unsupported_skipped_once():
    body = post("a1b!1é").json()
    assert [letter["char"] for letter in body["letters"]] == ["A", "B"]
    assert body["skipped"] == ["1", "!", "É"]


def test_empty_text():
    assert post("").json() == {"lang": "asl", "letters": [], "skipped": []}


def test_invalid_lang_rejected():
    assert post("a", "xyz").status_code == 422


def test_static_mount_serves_clip_files():
    clip = STATIC / "letters" / "asl" / "_pytest.json"
    clip.write_text('{"fps": 1, "frames": []}')
    try:
        resp = client.get("/static/letters/asl/_pytest.json")
        assert resp.status_code == 200
        assert resp.json() == {"fps": 1, "frames": []}
    finally:
        clip.unlink()
