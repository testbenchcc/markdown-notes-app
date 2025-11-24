import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_images_cleanup_dry_run_does_not_delete_files(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note_file = root / "folder" / "note.md"
    note_file.parent.mkdir(parents=True, exist_ok=True)
    note_file.write_text(
        """![img1](/files/Images/img1.png)\n<img src=\"/files/Images/img2.png\">""",
        encoding="utf8",
    )

    img1 = root / "Images" / "img1.png"
    img1.parent.mkdir(parents=True, exist_ok=True)
    img1.write_bytes(b"1")

    img2 = root / "Images" / "img2.png"
    img2.write_bytes(b"2")

    orphan = root / "Images" / "orphan.png"
    orphan.write_bytes(b"3")

    client = TestClient(main.app)

    resp = client.post("/api/images/cleanup")
    assert resp.status_code == 200
    data = resp.json()

    assert data["dryRun"] is True
    assert data["totalImages"] == 3
    assert data["referencedImages"] == 2
    assert data["unusedImages"] == 1
    assert "Images/orphan.png" in data["candidatePaths"]
    assert data["removedPaths"] == []

    assert img1.is_file()
    assert img2.is_file()
    assert orphan.is_file()


def test_images_cleanup_removes_unused_images_when_not_dry_run(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note_file = root / "note.md"
    note_file.write_text("![img1](/files/Images/img1.png)", encoding="utf8")

    img1 = root / "Images" / "img1.png"
    img1.parent.mkdir(parents=True, exist_ok=True)
    img1.write_bytes(b"1")

    orphan1 = root / "Images" / "orphan1.png"
    orphan1.write_bytes(b"x")
    orphan2 = root / "Images" / "nested" / "orphan2.png"
    orphan2.parent.mkdir(parents=True, exist_ok=True)
    orphan2.write_bytes(b"y")

    client = TestClient(main.app)

    resp = client.post("/api/images/cleanup", params={"dryRun": "false"})
    assert resp.status_code == 200
    data = resp.json()

    assert data["dryRun"] is False
    assert data["totalImages"] == 3
    assert data["referencedImages"] == 1
    assert data["unusedImages"] == 2

    candidate_paths = set(data["candidatePaths"])
    removed_paths = set(data["removedPaths"])

    assert "Images/orphan1.png" in candidate_paths
    assert "Images/nested/orphan2.png" in candidate_paths
    # We expect both orphans to be removed when dryRun is false
    assert "Images/orphan1.png" in removed_paths
    assert "Images/nested/orphan2.png" in removed_paths

    assert img1.is_file()
    assert not orphan1.exists()
    assert not orphan2.exists()
