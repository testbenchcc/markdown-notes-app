import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_get_settings_returns_default_when_missing(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    settings_path = cfg.settings_path

    # No settings file should exist initially
    assert not settings_path.exists()

    client = TestClient(main.app)
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "settings" in data
    settings = data["settings"]
    assert settings["tabLength"] == 4
    assert settings["theme"] == "base"
    assert settings["indexPageTitle"] == "NoteBooks"


def test_put_settings_validates_and_persists(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    settings_path = cfg.settings_path

    client = TestClient(main.app)

    resp = client.put("/api/settings", json={"tabLength": 6})
    assert resp.status_code == 200
    data = resp.json()
    assert data["settings"]["tabLength"] == 6

    assert settings_path.is_file()
    on_disk = settings_path.read_text(encoding="utf8")
    assert "tabLength" in on_disk


def test_put_settings_rejects_out_of_range_values(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)

    for bad in (1, 9):
        resp = client.put("/api/settings", json={"tabLength": bad})
        assert resp.status_code == 422


def test_put_settings_updates_theme_and_title(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)

    resp = client.put(
        "/api/settings",
        json={"theme": "high-contrast", "indexPageTitle": "My Notebook"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["settings"]["theme"] == "high-contrast"
    assert data["settings"]["indexPageTitle"] == "My Notebook"

    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["settings"]["theme"] == "high-contrast"
    assert data["settings"]["indexPageTitle"] == "My Notebook"


def test_get_note_uses_settings_tab_length(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note_file = root / "note.md"
    note_file.parent.mkdir(parents=True, exist_ok=True)
    note_file.write_text("\tIndented", encoding="utf8")

    captured: dict[str, int] = {}

    original_render = main._render_markdown_html

    def fake_render(text: str, tab_length: int = 4) -> str:  # type: ignore[override]
        captured["tab_length"] = tab_length
        return "<p>ok</p>"

    main._render_markdown_html = fake_render  # type: ignore[assignment]

    try:
        client = TestClient(main.app)

        # Update settings to a non-default value and ensure it flows into get_note
        resp = client.put("/api/settings", json={"tabLength": 7})
        assert resp.status_code == 200

        resp = client.get("/api/notes/note.md")
        assert resp.status_code == 200
        assert captured.get("tab_length") == 7
    finally:
        main._render_markdown_html = original_render  # type: ignore[assignment]


def test_settings_includes_and_updates_time_zone(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    client = TestClient(main.app)

    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    settings = data["settings"]
    assert "timeZone" in settings
    assert settings["timeZone"] is None

    resp = client.put("/api/settings", json={"timeZone": "America/Denver"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["settings"]["timeZone"] == "America/Denver"

    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["settings"]["timeZone"] == "America/Denver"
