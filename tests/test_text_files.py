import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_tree_includes_common_text_files(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    (root / "code.py").write_text("print('ok')", encoding="utf8")
    (root / "docs.txt").write_text("some docs", encoding="utf8")
    (root / "data.csv").write_text("a,b\n1,2\n", encoding="utf8")

    tree = main.build_notes_tree()
    types = {(n["type"], n["name"]) for n in tree}

    assert ("note", "code.py") in types
    assert ("note", "docs.txt") in types
    assert ("note", "data.csv") in types


def test_get_note_for_text_and_csv(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    txt_file = root / "logs" / "app.log"
    txt_file.parent.mkdir(parents=True, exist_ok=True)
    txt_file.write_text("INFO start", encoding="utf8")

    csv_file = root / "table.csv"
    csv_file.write_text("a,b\n1,2\n", encoding="utf8")

    client = TestClient(main.app)

    resp_txt = client.get("/api/notes/logs/app.log")
    assert resp_txt.status_code == 200
    data_txt = resp_txt.json()
    assert data_txt["path"] == "logs/app.log"
    assert data_txt["name"] == "app.log"
    assert data_txt["content"].startswith("INFO")
    assert data_txt.get("fileType") == "text"

    resp_csv = client.get("/api/notes/table.csv")
    assert resp_csv.status_code == 200
    data_csv = resp_csv.json()
    assert data_csv["path"] == "table.csv"
    assert data_csv["name"] == "table.csv"
    assert "1,2" in data_csv["content"]
    assert data_csv.get("fileType") == "csv"
