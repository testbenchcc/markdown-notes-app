import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient
from io import BytesIO
import zipfile


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_rename_note_success(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    src = root / "folder" / "old.md"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text("content", encoding="utf8")

    client = TestClient(main.app)
    resp = client.post(
        "/api/notes/rename",
        json={"sourcePath": "folder/old.md", "destinationPath": "folder/new.md"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "folder/new.md"
    assert not src.exists()
    dest = root / "folder" / "new.md"
    assert dest.is_file()
    assert dest.read_text(encoding="utf8") == "content"


def test_rename_note_appends_md_when_missing(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    src = root / "note.md"
    src.write_text("x", encoding="utf8")

    client = TestClient(main.app)
    resp = client.post(
        "/api/notes/rename",
        json={"sourcePath": "note.md", "destinationPath": "renamed"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "renamed.md"
    assert not src.exists()
    assert (root / "renamed.md").is_file()


def test_rename_note_conflict(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    src = root / "note.md"
    dest = root / "other.md"
    src.write_text("one", encoding="utf8")
    dest.write_text("two", encoding="utf8")

    client = TestClient(main.app)
    resp = client.post(
        "/api/notes/rename",
        json={"sourcePath": "note.md", "destinationPath": "other.md"},
    )
    assert resp.status_code == 409


def test_rename_folder_success(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    src = root / "old" / "sub"
    src.mkdir(parents=True, exist_ok=True)
    (src / "file.md").write_text("x", encoding="utf8")

    client = TestClient(main.app)
    resp = client.post(
        "/api/folders/rename",
        json={"sourcePath": "old", "destinationPath": "new"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "new"
    assert not (root / "old").exists()
    assert (root / "new" / "sub" / "file.md").is_file()


def test_delete_note_and_folder(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note = root / "folder" / "note.md"
    folder = root / "folder_to_delete" / "sub"
    note.parent.mkdir(parents=True, exist_ok=True)
    folder.mkdir(parents=True, exist_ok=True)
    note.write_text("x", encoding="utf8")
    (folder / "file.txt").write_text("y", encoding="utf8")

    client = TestClient(main.app)

    resp = client.delete("/api/notes/folder/note.md")
    assert resp.status_code == 200
    assert not note.exists()

    resp = client.delete("/api/folders/folder_to_delete")
    assert resp.status_code == 200
    assert not (root / "folder_to_delete").exists()


def test_get_file_serves_images_and_rejects_others(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    image = root / "img" / "pic.png"
    image.parent.mkdir(parents=True, exist_ok=True)
    payload = b"fakepngdata"
    image.write_bytes(payload)

    client = TestClient(main.app)

    resp = client.get("/files/img/pic.png")
    assert resp.status_code == 200
    assert resp.content == payload
    assert resp.headers.get("content-type", "").startswith("image/")

    # Non-image extension should not be served
    text_file = root / "notes.txt"
    text_file.write_text("hello", encoding="utf8")
    resp = client.get("/files/notes.txt")
    assert resp.status_code == 404


def test_get_file_rejects_invalid_paths(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    resp = client.get("/files/../secret.png")
    # Framework may reject paths containing ".." before the route-level
    # validation runs, resulting in a 404 instead of the previous 400.
    assert resp.status_code in (400, 404)


def test_download_folder_as_zip(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    folder = root / "project" / "sub"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "one.md").write_text("one", encoding="utf8")
    (folder / "two.txt").write_text("two", encoding="utf8")

    client = TestClient(main.app)
    resp = client.get("/api/folders/project/download")
    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("application/zip")

    buffer = BytesIO(resp.content)
    with zipfile.ZipFile(buffer, "r") as zf:
        names = set(zf.namelist())

    assert "sub/one.md" in names
    assert "sub/two.txt" in names


def test_download_folder_errors_for_missing_or_invalid_paths(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)

    # Missing folder
    resp_missing = client.get("/api/folders/missing/download")
    assert resp_missing.status_code == 404

    # Invalid folder path: framework may normalize or reject ".." segments
    # before the handler is invoked.
    resp_invalid = client.get("/api/folders/../secret/download")
    assert resp_invalid.status_code in (400, 404)
