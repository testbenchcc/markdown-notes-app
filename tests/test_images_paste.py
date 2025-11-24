import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_paste_image_succeeds_and_stores_file(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note_file = root / "folder" / "note.md"
    note_file.parent.mkdir(parents=True, exist_ok=True)
    note_file.write_text("# Title", encoding="utf8")

    client = TestClient(main.app)

    payload = b"fakepngdata"
    resp = client.post(
        "/api/images/paste",
        data={"note_path": "folder/note.md"},
        files={"file": ("pic.png", payload, "image/png")},
    )
    assert resp.status_code == 200
    data = resp.json()

    assert "path" in data
    assert "markdown" in data
    assert "size" in data
    assert data["size"] == len(payload)

    rel_path = Path(data["path"])  # type: ignore[arg-type]
    stored_image = root / rel_path
    assert stored_image.is_file()
    assert stored_image.read_bytes() == payload

    markdown = data["markdown"]
    assert markdown.startswith("![image](")
    assert data["path"] in markdown


def test_paste_image_rejects_unsupported_type(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    resp = client.post(
        "/api/images/paste",
        data={"note_path": "note.md"},
        files={"file": ("doc.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body.get("detail") == "Unsupported image type"


def test_paste_image_respects_max_size_from_settings(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    settings_resp = client.put("/api/settings", json={"imageMaxPasteBytes": 4})
    assert settings_resp.status_code == 200

    payload = b"12345"  # 5 bytes, greater than configured limit of 4
    resp = client.post(
        "/api/images/paste",
        data={"note_path": "note.md"},
        files={"file": ("pic.png", payload, "image/png")},
    )
    assert resp.status_code == 413
    body = resp.json()
    assert "too large" in body.get("detail", "").lower()


def test_paste_image_rejects_invalid_note_path(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    resp = client.post(
        "/api/images/paste",
        data={"note_path": "../secret.md"},
        files={"file": ("pic.png", b"data", "image/png")},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert "must not contain" in body.get("detail", "").lower() or "must be relative" in body.get("detail", "").lower()