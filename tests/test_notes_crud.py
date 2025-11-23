import importlib
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_get_note_returns_content_and_html(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note_file = root / "folder" / "note.md"
    note_file.parent.mkdir(parents=True, exist_ok=True)
    note_file.write_text("# Title\n\nSome *content*.", encoding="utf8")

    client = TestClient(main.app)
    resp = client.get("/api/notes/folder/note.md")
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "folder/note.md"
    assert data["name"] == "note.md"
    assert "Some *content*" in data["content"]
    assert "<h1" in data["html"] or "<h1" in data["html"].lower()


def test_get_note_404_for_missing(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)
    resp = client.get("/api/notes/missing.md")
    assert resp.status_code == 404


@pytest.mark.parametrize("bad_path", ["../secret.md", "C:/windows", "/absolute.md"])
def test_get_note_400_for_invalid_path(tmp_path, bad_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)
    resp = client.get(f"/api/notes/{bad_path}")
    assert resp.status_code == 400


def test_put_note_creates_and_overwrites(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    client = TestClient(main.app)

    resp = client.put("/api/notes/folder/created.md", json={"content": "first"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "folder/created.md"
    assert (root / "folder" / "created.md").read_text(encoding="utf8") == "first"

    resp = client.put("/api/notes/folder/created.md", json={"content": "second"})
    assert resp.status_code == 200
    assert (root / "folder" / "created.md").read_text(encoding="utf8") == "second"


def test_create_folder_creates_nested_and_gitkeep(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    client = TestClient(main.app)
    resp = client.post("/api/folders", json={"path": "a/b/c"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["path"] == "a/b/c"
    folder = root / "a" / "b" / "c"
    assert folder.is_dir()
    assert (folder / ".gitkeep").is_file()


def test_create_note_appends_md_and_conflicts(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    client = TestClient(main.app)

    resp = client.post("/api/notes", json={"path": "folder/new-note", "content": "hello"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["path"] == "folder/new-note.md"
    note_file = root / "folder" / "new-note.md"
    assert note_file.is_file()
    assert note_file.read_text(encoding="utf8") == "hello"

    resp = client.post("/api/notes", json={"path": "folder/new-note"})
    assert resp.status_code == 409
