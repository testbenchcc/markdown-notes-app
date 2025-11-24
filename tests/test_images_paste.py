import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_paste_image_saves_under_local_images_folder(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note = root / "folder" / "note.md"
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text("x", encoding="utf8")

    client = TestClient(main.app)

    image_bytes = b"fakepngdata"
    files = {"file": ("pasted.png", image_bytes, "image/png")}
    data = {"note_path": "folder/note.md"}

    resp = client.post("/api/images/paste", data=data, files=files)
    assert resp.status_code == 200
    payload = resp.json()

    rel_path = payload["path"]
    name = payload["name"]
    markdown = payload["markdown"]

    # Image is written under a local Images subfolder next to the note by default.
    dest = root / "folder" / "Images" / name
    assert dest.is_file()
    assert dest.read_bytes() == image_bytes

    # The markdown snippet points at the files endpoint with the same relative path.
    assert rel_path == f"folder/Images/{name}"
    assert markdown == f"![image](/files/{rel_path})"

    file_resp = client.get(f"/files/{rel_path}")
    assert file_resp.status_code == 200
    assert file_resp.content == image_bytes


def test_paste_image_rejects_oversized_upload(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)

    # Set a very small max size so we can easily exceed it.
    resp = client.put("/api/settings", json={"imageMaxPasteBytes": 8})
    assert resp.status_code == 200

    files = {"file": ("big.png", b"0" * 16, "image/png")}
    data = {"note_path": "note.md"}

    resp = client.post("/api/images/paste", data=data, files=files)
    assert resp.status_code == 413


def test_paste_image_rejects_unsupported_type(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)

    # Non-image content type and extension should be rejected.
    files = {"file": ("note.txt", b"hello", "text/plain")}
    data = {"note_path": "note.md"}

    resp = client.post("/api/images/paste", data=data, files=files)
    assert resp.status_code == 400


def test_paste_image_uses_content_type_to_guess_extension(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    client = TestClient(main.app)

    image_bytes = b"fakepngdata2"
    # Unknown extension, but image/png content type: server should fall back to .png
    files = {"file": ("clipboard", image_bytes, "image/png")}
    data = {"note_path": "note.md"}

    resp = client.post("/api/images/paste", data=data, files=files)
    assert resp.status_code == 200
    payload = resp.json()

    rel_path = payload["path"]
    name = payload["name"]

    assert name.endswith(".png")
    dest = root / rel_path
    assert dest.is_file()
    assert dest.read_bytes() == image_bytes
