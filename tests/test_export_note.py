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


def test_export_note_returns_html_download(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note_file = root / "folder" / "note.md"
    note_file.parent.mkdir(parents=True, exist_ok=True)
    note_file.write_text("# Title\n\nSome *content*.", encoding="utf8")

    client = TestClient(main.app)
    resp = client.get("/api/export-note/folder/note.md")

    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("text/html")
    cd = resp.headers.get("content-disposition", "")
    assert "attachment" in cd.lower()
    assert "note.html" in cd

    body = resp.text
    assert "<html" in body.lower()
    assert "Some *content*" not in body  # markdown should be rendered
    assert "<h1" in body or "<h1" in body.lower()


def test_export_note_404_for_missing(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    resp = client.get("/api/export-note/missing.md")
    assert resp.status_code == 404


@pytest.mark.parametrize("bad_path", ["../secret.md", "C:/windows", "/absolute.md"])
def test_export_note_400_or_404_for_invalid_path(tmp_path, bad_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    resp = client.get(f"/api/export-note/{bad_path}")

    if bad_path.startswith("../"):
        # Starlette may reject paths containing ".." before the route handler is invoked.
        assert resp.status_code == 404
    else:
        assert resp.status_code == 400
