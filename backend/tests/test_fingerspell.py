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
            {"char": "H", "clip_url": "/static/letters/isl/H.json", "pause": False},
            {"char": "I", "clip_url": "/static/letters/isl/I.json", "pause": False},
        ],
        "skipped": [],
    }


def test_case_insensitive():
    assert post("Hello").json()["letters"] == post("HELLO").json()["letters"]


def test_space_is_a_pause_between_words():
    body = post("a b	c").json()
    assert body["letters"] == [
        {"char": "A", "clip_url": "/static/letters/asl/A.json", "pause": False},
        {"char": " ", "clip_url": None, "pause": True},
        {"char": "B", "clip_url": "/static/letters/asl/B.json", "pause": False},
        {"char": " ", "clip_url": None, "pause": True},
        {"char": "C", "clip_url": "/static/letters/asl/C.json", "pause": False},
    ]
    assert body["skipped"] == []


def test_repeated_leading_and_trailing_spaces_collapse():
    body = post("  hi   there  ").json()
    chars = "".join(letter["char"] for letter in body["letters"])
    assert chars == "HI THERE"
    assert sum(letter["pause"] for letter in body["letters"]) == 1


def test_only_spaces_gives_no_letters():
    assert post("   ").json()["letters"] == []


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
