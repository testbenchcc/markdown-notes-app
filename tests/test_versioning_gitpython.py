import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_commit_and_push_creates_commit_when_changes_present(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note = root / "note.md"
    note.write_text("hello", encoding="utf8")

    client = TestClient(main.app)

    resp = client.post(
        "/api/versioning/notes/commit-and-push",
        json={"message": "test commit"},
    )
    assert resp.status_code == 200
    data = resp.json()

    assert isinstance(data.get("committed"), bool)
    assert data["committed"] is True
    assert isinstance(data.get("commit"), dict)
    assert data["commit"].get("hexsha")

    # A second call without changes should result in no new commit.
    resp2 = client.post("/api/versioning/notes/commit-and-push")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["committed"] is False


def test_gitignore_add_and_remove_pattern(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    client = TestClient(main.app)

    # Add a pattern
    resp_add = client.post(
        "/api/versioning/notes/gitignore/add",
        json={"pattern": "*.log"},
    )
    assert resp_add.status_code == 200
    data_add = resp_add.json()
    assert data_add["pattern"] == "*.log"
    assert data_add["added"] is True

    gitignore_path = root / ".gitignore"
    assert gitignore_path.is_file()
    lines = gitignore_path.read_text(encoding="utf8").splitlines()
    assert "*.log" in lines

    # Adding the same pattern again should be a no-op but still succeed.
    resp_add_again = client.post(
        "/api/versioning/notes/gitignore/add",
        json={"pattern": "*.log"},
    )
    assert resp_add_again.status_code == 200
    data_add_again = resp_add_again.json()
    assert data_add_again["added"] is False

    # Remove the pattern
    resp_remove = client.post(
        "/api/versioning/notes/gitignore/remove",
        json={"pattern": "*.log"},
    )
    assert resp_remove.status_code == 200
    data_remove = resp_remove.json()
    assert data_remove["pattern"] == "*.log"
    assert data_remove["removed"] is True

    lines_after = gitignore_path.read_text(encoding="utf8").splitlines()
    assert "*.log" not in lines_after


def test_pull_without_remote_is_skipped(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)
    resp = client.post("/api/versioning/notes/pull")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "skipped"


def test_auto_sync_status_includes_time_zone_from_settings(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)

    resp = client.put("/api/settings", json={"timeZone": "UTC"})
    assert resp.status_code == 200

    resp = client.get("/api/versioning/notes/auto-sync-status")
    assert resp.status_code == 200
    data = resp.json()
    settings = data.get("settings") or {}
    assert settings.get("timeZone") == "UTC"
