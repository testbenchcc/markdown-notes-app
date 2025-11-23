"""FastAPI entrypoint for the Markdown Notes App.

This initial v0.1.0 bootstrap focuses on:
- Establishing a FastAPI application instance.
- Centralizing resolution of the notes root directory.
- Defining the path for the settings JSON file.
- Exposing a basic GET /health endpoint.

Later roadmap versions will add the full notes, settings, search, and
versioning APIs described in README.md and roadmap.md.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI
from fastapi.responses import FileResponse


APP_ROOT = Path(__file__).resolve().parent


class AppConfig:
    """Application configuration for the Markdown Notes App.

    For v0.1.0, this only covers paths that must be well-defined early:
    - notes_root: base directory for all notebook content
    - settings_path: JSON file used to persist NotebookSettings

    The notes root can be configured via the NOTES_ROOT environment
    variable. If it is a relative path, it is resolved relative to
    APP_ROOT. If omitted, it defaults to APP_ROOT / "notes".
    """

    def __init__(self) -> None:
        self.notes_root = self._resolve_notes_root()
        self.settings_path = self.notes_root / ".notebook-settings.json"

    @staticmethod
    def _resolve_notes_root() -> Path:
        env_value = os.getenv("NOTES_ROOT")

        if env_value:
            candidate = Path(env_value)
            if not candidate.is_absolute():
                candidate = (APP_ROOT / candidate).resolve()
        else:
            candidate = (APP_ROOT / "notes").resolve()

        # Ensure the directory exists so later endpoints can rely on it.
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    """Return a cached AppConfig instance.

    Using a small cache keeps configuration resolution cheap and ensures
    that directory creation for the notes root happens only once.
    """

    return AppConfig()


NOTE_FILE_EXTENSION = ".md"
IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
}


def _validate_relative_path(path_str: str) -> str:
    raw = path_str.strip()
    if not raw:
        raise ValueError("Path must not be empty")

    if ":" in raw:
        raise ValueError("Path must be relative and must not contain drive specifiers")

    path = Path(raw)

    if path.is_absolute():
        raise ValueError("Path must be relative")

    parts: List[str] = list(path.parts)

    if any(part == ".." for part in parts):
        raise ValueError("Path must not contain '..' segments")

    normalized = Path(*[part for part in parts if part not in (".", "")])

    if not normalized.parts:
        raise ValueError("Path must not resolve to empty")

    return normalized.as_posix()


def _resolve_relative_path(relative_path: str) -> Path:
    cfg = get_config()
    safe_rel = _validate_relative_path(relative_path)
    target = (cfg.notes_root / safe_rel).resolve()

    try:
        target.relative_to(cfg.notes_root)
    except ValueError as exc:  # pragma: no cover - defensive branch
        raise ValueError("Resolved path escapes the notes root") from exc

    return target


def _resolve_destination_path(source_relative: str, destination_relative: str) -> tuple[Path, Path]:
    source = _resolve_relative_path(source_relative)
    destination = _resolve_relative_path(destination_relative)

    if source == destination:
        raise ValueError("Source and destination paths must be different")

    return source, destination


def _build_tree_for_directory(directory: Path, root: Path) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []

    for child in sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
        if child.name.startswith("."):
            continue

        if child.is_dir():
            node: Dict[str, Any] = {
                "type": "folder",
                "name": child.name,
                "path": child.relative_to(root).as_posix(),
                "children": _build_tree_for_directory(child, root),
            }
            entries.append(node)
        elif child.is_file():
            suffix = child.suffix.lower()

            if suffix == NOTE_FILE_EXTENSION:
                node_type = "note"
            elif suffix in IMAGE_EXTENSIONS:
                node_type = "image"
            else:
                continue

            entries.append(
                {
                    "type": node_type,
                    "name": child.name,
                    "path": child.relative_to(root).as_posix(),
                }
            )

    return entries


def build_notes_tree() -> List[Dict[str, Any]]:
    cfg = get_config()
    root = cfg.notes_root
    return _build_tree_for_directory(root, root)


app = FastAPI(title="Markdown Notes App", version="0.1.0")


@app.get("/", response_class=FileResponse, tags=["ui"])
def index() -> FileResponse:
    index_path = APP_ROOT / "static" / "index.html"
    return FileResponse(index_path)


@app.get("/health", tags=["system"])
def health() -> Dict[str, Any]:
    """Basic health and configuration probe.

    This endpoint is intentionally lightweight and safe to call often.
    It confirms that the application is running and that the notes root
    and settings path are resolvable.
    """

    cfg = get_config()

    return {
        "status": "ok",
        "version": "0.1.0",
        "notesRoot": str(cfg.notes_root),
        "settingsPath": str(cfg.settings_path),
    }


@app.get("/api/tree", tags=["notes"])
def api_tree() -> Dict[str, Any]:
    cfg = get_config()
    tree = build_notes_tree()

    return {
        "root": str(cfg.notes_root),
        "nodes": tree,
    }


if __name__ == "__main__":  # pragma: no cover - manual/dev entrypoint
    # This allows `python main.py` in addition to `uvicorn main:app`.
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("UVICORN_RELOAD", "true").lower() == "true",
    )
