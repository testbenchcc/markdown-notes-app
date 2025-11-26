import importlib
import os
from collections import Counter
from pathlib import Path

from fastapi.testclient import TestClient


def reload_main_with_temp_root(tmp_path: Path):
    os.environ["NOTES_ROOT"] = str(tmp_path / "notes-root")

    import main  # type: ignore

    importlib.reload(main)
    return main


def test_search_returns_match_and_is_case_insensitive(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    note = root / "note.md"
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text("First line\nsecond line\nSearch me\n", encoding="utf8")

    client = TestClient(main.app)

    resp = client.get("/api/search", params={"q": "search"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == "search"
    results = data["results"]
    assert len(results) == 1
    result = results[0]
    assert result["path"] == "note.md"
    assert result["lineNumber"] == 3
    assert "Search me" in result["lineText"]


def test_search_empty_query_returns_no_results(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    resp = client.get("/api/search", params={"q": "   "})
    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == ""
    assert data["results"] == []


def test_search_rejects_too_long_query(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    client = TestClient(main.app)

    limit = main.SEARCH_MAX_QUERY_LENGTH

    resp_ok = client.get("/api/search", params={"q": "a" * limit})
    assert resp_ok.status_code == 200

    resp_too_long = client.get("/api/search", params={"q": "a" * (limit + 1)})
    assert resp_too_long.status_code == 400
    body = resp_too_long.json()
    assert "Query too long" in body.get("detail", "")


def test_search_respects_per_file_match_cap(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    per_file_limit = main.SEARCH_MAX_MATCHES_PER_FILE

    note = root / "note.md"
    note.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"match line {i}" for i in range(per_file_limit + 10)]
    note.write_text("\n".join(lines), encoding="utf8")

    client = TestClient(main.app)
    resp = client.get("/api/search", params={"q": "match"})
    assert resp.status_code == 200
    data = resp.json()
    results = data["results"]

    # All results should come from the single note file
    assert all(r["path"] == "note.md" for r in results)
    # No more than the configured per-file limit of matches are returned
    assert len(results) == per_file_limit
    # Line numbers should not exceed the per-file cap
    assert max(r["lineNumber"] for r in results) <= per_file_limit


def test_search_respects_global_result_cap(tmp_path):
    main = reload_main_with_temp_root(tmp_path)
    cfg = main.get_config()
    root = cfg.notes_root

    per_file_limit = main.SEARCH_MAX_MATCHES_PER_FILE
    global_limit = main.SEARCH_MAX_RESULTS

    # Create enough notes so that the total possible matches exceed the global cap
    needed_files = global_limit // per_file_limit + 1

    for i in range(needed_files):
        note = root / f"note-{i}.md"
        note.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"match line {j}" for j in range(per_file_limit)]
        note.write_text("\n".join(lines), encoding="utf8")

    client = TestClient(main.app)
    resp = client.get("/api/search", params={"q": "match"})
    assert resp.status_code == 200
    data = resp.json()
    results = data["results"]

    # The total number of results should be capped at the configured global maximum
    assert len(results) == global_limit

    # No individual file should contribute more matches than the per-file cap
    counts = Counter(r["path"] for r in results)
    assert all(count <= per_file_limit for count in counts.values())
