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


def test_validate_relative_path_accepts_simple_paths(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    assert main._validate_relative_path("foo/bar.md") == "foo/bar.md"
    assert main._validate_relative_path("  folder/note.md  ") == "folder/note.md"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "   ",
        "/etc/passwd",
        "C:\\Windows",
        "../foo",
        "foo/../..",
    ],
)
def test_validate_relative_path_rejects_bad_inputs(tmp_path, bad):
    main = reload_main_with_temp_root(tmp_path)

    with pytest.raises(ValueError):
        main._validate_relative_path(bad)


def test_resolve_relative_path_stays_within_root(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    root = main.get_config().notes_root
    target = main._resolve_relative_path("subdir/note.md")

    assert target == root / "subdir" / "note.md"
    assert target.is_absolute()
    assert root in target.parents or target == root


def test_resolve_destination_path_requires_different_paths(tmp_path):
    main = reload_main_with_temp_root(tmp_path)

    src, dest = main._resolve_destination_path("a/note.md", "b/note.md")
    assert src != dest

    with pytest.raises(ValueError):
        main._resolve_destination_path("same.md", "same.md")


def test_build_notes_tree_and_api_tree(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    (root / ".hidden").mkdir(parents=True, exist_ok=True)
    (root / ".hidden" / "ignored.md").write_text("# Hidden", encoding="utf8")
    (root / "folder1").mkdir(parents=True, exist_ok=True)
    (root / "folder1" / "note1.md").write_text("# Note 1", encoding="utf8")
    (root / "folder1" / "image1.png").write_bytes(b"fakepng")
    (root / "folder1" / "ignore.txt").write_text("ignore", encoding="utf8")
    (root / "root-note.md").write_text("# Root note", encoding="utf8")

    tree = main.build_notes_tree()

    types = {(n["type"], n["name"]) for n in tree}
    assert ("folder", "folder1") in types
    assert ("note", "root-note.md") in types

    folder1 = next(n for n in tree if n["type"] == "folder" and n["name"] == "folder1")
    child_types = {(n["type"], n["name"]) for n in folder1["children"]}
    assert ("note", "note1.md") in child_types
    assert ("image", "image1.png") in child_types
    assert all(name != "ignore.txt" for _, name in child_types)

    client = TestClient(main.app)
    resp = client.get("/api/tree")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["root"] == str(root)
    assert isinstance(payload["nodes"], list)
    assert any(node["name"] == "root-note.md" for node in payload["nodes"])
