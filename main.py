"""FastAPI Markdown Notes application.

Usage (non-Docker):

    python -m venv .venv
    # activate the venv (platform-specific)
    pip install -r requirements.txt
    uvicorn main:app --reload

Usage (Docker Compose):

    docker compose up --build
    # or: docker-compose up --build

Notes are stored as `.md` files under the `notes/` folder in the same
repository. Subfolders represent categories.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import markdown
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Determine application root based on this file location.
APP_ROOT = Path(__file__).resolve().parent

# Root folder where markdown notes are stored. Change this in one place if
# you want to point the app at a different notes directory.
_env_notes_root = os.getenv("NOTES_ROOT")
if _env_notes_root:
    _candidate_root = Path(_env_notes_root)
    if not _candidate_root.is_absolute():
        _candidate_root = (APP_ROOT / _candidate_root).resolve()
    NOTES_ROOT = _candidate_root
else:
    NOTES_ROOT = APP_ROOT / "notes"


class SaveNoteRequest(BaseModel):
    content: str


class CreatePathRequest(BaseModel):
    path: str
    content: str | None = None


def ensure_notes_root() -> None:
    """Ensure the notes root directory exists."""

    NOTES_ROOT.mkdir(parents=True, exist_ok=True)


def _validate_relative_path(relative_path: str) -> str:
    """Normalise and validate a path relative to NOTES_ROOT.

    Rejects empty paths, absolute paths, and any path that attempts to
    escape the notes root using `..`.
    """

    cleaned = relative_path.strip().lstrip("/\\")
    if not cleaned:
        raise HTTPException(status_code=400, detail="Path must not be empty")

    candidate = Path(cleaned)
    if candidate.is_absolute() or any(part in {"..", ""} for part in candidate.parts):
        raise HTTPException(status_code=400, detail="Invalid path")

    # Normalise separators to forward slashes for API responses.
    return candidate.as_posix()


def _resolve_relative_path(relative_path: str) -> Path:
    """Resolve a path under NOTES_ROOT and guard against traversal."""

    safe_rel = _validate_relative_path(relative_path)
    base = NOTES_ROOT.resolve()
    full = (base / safe_rel).resolve()

    if base not in full.parents and full != base:
        raise HTTPException(status_code=400, detail="Path escapes notes root")

    return full


def build_notes_tree() -> Dict[str, Any]:
    """Recursively build a tree of folders and notes under NOTES_ROOT.

    Each node has:
        - type: "folder" or "note"
        - name: basename of the folder or file
        - path: path relative to NOTES_ROOT (forward slashes)
        - children: list of child nodes (folders only)
    """

    ensure_notes_root()
    root_path = NOTES_ROOT.resolve()

    def build_node(path: Path, relative: Path | None = None) -> Dict[str, Any]:
        rel = relative if relative is not None else Path("")
        rel_str = rel.as_posix() if rel != Path("") else ""

        if path.is_dir():
            children = []
            for child in sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
                # Only include markdown files and directories.
                if child.is_dir() or (child.is_file() and child.suffix.lower() == ".md"):
                    child_rel = rel / child.name if rel != Path("") else Path(child.name)
                    children.append(build_node(child, child_rel))

            return {
                "type": "folder",
                "name": path.name if rel != Path("") else "",
                "path": rel_str,
                "children": children,
            }

        # Note node
        return {
            "type": "note",
            "name": path.name,
            "path": rel_str,
        }

    return build_node(root_path)


app = FastAPI(title="Markdown Notes App", version="1.0.0")


@app.on_event("startup")
def on_startup() -> None:
    """Create the notes directory on startup if it does not exist."""

    ensure_notes_root()


# Serve static frontend assets.
app.mount("/static", StaticFiles(directory=APP_ROOT / "static"), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    """Serve the single-page frontend."""

    index_file = APP_ROOT / "static" / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=500, detail="Frontend not found")
    return FileResponse(index_file)


@app.get("/api/tree")
async def get_tree() -> Dict[str, Any]:
    """Return the notes folder hierarchy starting at NOTES_ROOT."""

    return build_notes_tree()


@app.get("/api/notes/{note_path:path}")
async def get_note(note_path: str) -> Dict[str, Any]:
    """Return a single note's raw markdown and rendered HTML."""

    ensure_notes_root()
    file_path = _resolve_relative_path(note_path)

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Note not found")

    if file_path.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Not a markdown file")

    raw = file_path.read_text(encoding="utf-8")
    html = markdown.markdown(raw, extensions=["extra"])  # simple markdown renderer

    rel_path = file_path.relative_to(NOTES_ROOT).as_posix()

    return {
        "path": rel_path,
        "name": file_path.name,
        "content": raw,
        "html": html,
    }


@app.put("/api/notes/{note_path:path}")
async def save_note(note_path: str, payload: SaveNoteRequest) -> Dict[str, Any]:
    """Create or overwrite a markdown note at the given relative path."""

    ensure_notes_root()
    file_path = _resolve_relative_path(note_path)

    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(payload.content, encoding="utf-8")

    rel_path = file_path.relative_to(NOTES_ROOT).as_posix()

    return {"ok": True, "path": rel_path, "name": file_path.name}


@app.post("/api/folders")
async def create_folder(payload: CreatePathRequest) -> Dict[str, Any]:
    """Create a new folder (category) under the notes root.

    The payload `path` must be a folder path relative to NOTES_ROOT.
    """

    ensure_notes_root()
    folder_path = _resolve_relative_path(payload.path)
    folder_path.mkdir(parents=True, exist_ok=True)

    rel_path = folder_path.relative_to(NOTES_ROOT).as_posix()

    return {"ok": True, "path": rel_path}


@app.post("/api/notes")
async def create_note(payload: CreatePathRequest) -> Dict[str, Any]:
    """Create a new markdown note at the given relative path.

    If `content` is omitted it defaults to an empty file.
    """

    ensure_notes_root()
    requested_path = payload.path
    if not requested_path.lower().endswith(".md"):
        requested_path = f"{requested_path}.md"
    file_path = _resolve_relative_path(requested_path)

    if file_path.exists():
        raise HTTPException(status_code=400, detail="Note already exists")

    file_path.parent.mkdir(parents=True, exist_ok=True)
    initial_content = payload.content or ""
    file_path.write_text(initial_content, encoding="utf-8")

    rel_path = file_path.relative_to(NOTES_ROOT).as_posix()

    return {"ok": True, "path": rel_path, "name": file_path.name}
