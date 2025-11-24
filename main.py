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

import json
import mimetypes
import os
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

import markdown
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, conint


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


class NotebookSettings(BaseModel):
    tabLength: conint(ge=2, le=8) = 4

    class Config:
        extra = "ignore"


_DEFAULT_SETTINGS = NotebookSettings()


def _load_settings() -> NotebookSettings:
    cfg = get_config()
    path = cfg.settings_path

    if not path.is_file():
        return _DEFAULT_SETTINGS

    try:
        raw = path.read_text(encoding="utf8")
    except OSError:  # pragma: no cover - defensive fallback
        return _DEFAULT_SETTINGS

    try:
        data = json.loads(raw)
    except ValueError:
        return _DEFAULT_SETTINGS

    try:
        return NotebookSettings.parse_obj(data)
    except Exception:  # pragma: no cover - defensive fallback
        return _DEFAULT_SETTINGS


def _save_settings(settings: NotebookSettings) -> None:
    cfg = get_config()
    path = cfg.settings_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(settings.json(indent=2, sort_keys=True), encoding="utf8")


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
DEFAULT_TAB_LENGTH = 4


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


def _preprocess_mermaid_fences(text: str) -> str:
    lines: List[str] = []
    in_mermaid = False
    buffer: List[str] = []

    for line in text.splitlines():
        if not in_mermaid and line.lstrip().startswith("```mermaid"):
            in_mermaid = True
            buffer = []
            continue
        if in_mermaid and line.lstrip().startswith("```"):
            in_mermaid = False
            body = "\n".join(buffer).strip("\n")
            lines.append(f'<div class="mermaid">{body}</div>')
            buffer = []
            continue
        if in_mermaid:
            buffer.append(line)
        else:
            lines.append(line)

    if in_mermaid and buffer:
        lines.extend(buffer)

    return "\n".join(lines)


def _render_markdown_html(markdown_text: str, tab_length: int = DEFAULT_TAB_LENGTH) -> str:
    processed = _preprocess_mermaid_fences(markdown_text)
    html = markdown.markdown(
        processed,
        extensions=["extra", "codehilite", "pymdownx.tasklist"],
        extension_configs={
            "codehilite": {
                "linenums": False,
                "guess_lang": False,
                "noclasses": True,
            }
        },
        output_format="html5",
        tab_length=tab_length,
    )
    return html


class NoteContent(BaseModel):
    content: str


class CreateFolderRequest(BaseModel):
    path: str


class CreateNoteRequest(BaseModel):
    path: str
    content: str | None = None


class RenameRequest(BaseModel):
    sourcePath: str
    destinationPath: str


app = FastAPI(title="Markdown Notes App", version="0.1.0")


STATIC_DIR = APP_ROOT / "static"
MONACO_STATIC_DIR = APP_ROOT / "node_modules" / "monaco-editor" / "min"
MARKDOWN_IT_STATIC_DIR = APP_ROOT / "node_modules" / "markdown-it" / "dist"
FANCYTREE_STATIC_DIR = APP_ROOT / "node_modules" / "jquery.fancytree" / "dist"

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if MONACO_STATIC_DIR.is_dir():
    app.mount("/vendor/monaco", StaticFiles(directory=MONACO_STATIC_DIR), name="monaco")

if MARKDOWN_IT_STATIC_DIR.is_dir():
    app.mount(
        "/vendor/markdown-it",
        StaticFiles(directory=MARKDOWN_IT_STATIC_DIR),
        name="markdown_it",
    )

if FANCYTREE_STATIC_DIR.is_dir():
    app.mount("/vendor/fancytree", StaticFiles(directory=FANCYTREE_STATIC_DIR), name="fancytree")


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


def _relative_to_notes_root(path: Path) -> str:
    cfg = get_config()
    return path.relative_to(cfg.notes_root).as_posix()


@app.get("/api/settings", tags=["settings"])
def get_settings() -> Dict[str, Any]:
    settings = _load_settings()
    return {"settings": settings.dict()}


@app.put("/api/settings", tags=["settings"])
def update_settings(payload: NotebookSettings) -> Dict[str, Any]:
    settings = NotebookSettings.parse_obj({**_DEFAULT_SETTINGS.dict(), **payload.dict()})
    _save_settings(settings)
    return {"settings": settings.dict()}


@app.get("/api/notes/{note_path:path}", tags=["notes"])
def get_note(note_path: str) -> Dict[str, Any]:
    try:
        note_file = _resolve_relative_path(note_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not note_file.is_file():
        raise HTTPException(status_code=404, detail="Note not found")

    content = note_file.read_text(encoding="utf8")
    settings = _load_settings()
    html = _render_markdown_html(content, tab_length=settings.tabLength)

    return {
        "path": _relative_to_notes_root(note_file),
        "name": note_file.name,
        "content": content,
        "html": html,
    }


@app.put("/api/notes/{note_path:path}", tags=["notes"])
def put_note(note_path: str, payload: NoteContent) -> Dict[str, Any]:
    try:
        note_file = _resolve_relative_path(note_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    note_file.parent.mkdir(parents=True, exist_ok=True)
    note_file.write_text(payload.content, encoding="utf8")

    return {
        "path": _relative_to_notes_root(note_file),
        "name": note_file.name,
    }


@app.post("/api/notes/rename", tags=["notes"])
def rename_note(payload: RenameRequest) -> Dict[str, Any]:
    source_path = payload.sourcePath
    destination_path = payload.destinationPath

    if not destination_path.endswith(NOTE_FILE_EXTENSION):
        destination_path = f"{destination_path}{NOTE_FILE_EXTENSION}"

    try:
        source, destination = _resolve_destination_path(source_path, destination_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not source.is_file():
        raise HTTPException(status_code=404, detail="Source note not found")

    if destination.exists():
        raise HTTPException(status_code=409, detail="Destination note already exists")

    destination.parent.mkdir(parents=True, exist_ok=True)
    source.rename(destination)

    return {
        "path": _relative_to_notes_root(destination),
        "name": destination.name,
    }


@app.post("/api/folders/rename", tags=["notes"])
def rename_folder(payload: RenameRequest) -> Dict[str, Any]:
    try:
        source, destination = _resolve_destination_path(payload.sourcePath, payload.destinationPath)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not source.is_dir():
        raise HTTPException(status_code=404, detail="Source folder not found")

    if destination.exists():
        raise HTTPException(status_code=409, detail="Destination folder already exists")

    destination.parent.mkdir(parents=True, exist_ok=True)
    source.rename(destination)

    return {
        "path": _relative_to_notes_root(destination),
        "name": destination.name,
    }


@app.delete("/api/notes/{note_path:path}", tags=["notes"])
def delete_note(note_path: str) -> Dict[str, Any]:
    try:
        note_file = _resolve_relative_path(note_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not note_file.is_file():
        raise HTTPException(status_code=404, detail="Note not found")

    note_file.unlink()

    return {
        "path": note_path,
        "deleted": True,
    }


@app.delete("/api/folders/{folder_path:path}", tags=["notes"])
def delete_folder(folder_path: str) -> Dict[str, Any]:
    try:
        folder = _resolve_relative_path(folder_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")

    shutil.rmtree(folder)

    return {
        "path": folder_path,
        "deleted": True,
    }


@app.get("/files/{file_rel_path:path}", tags=["files"])
def get_file(file_rel_path: str) -> FileResponse:
    try:
        file_path = _resolve_relative_path(file_rel_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    suffix = file_path.suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Unsupported file type")

    content_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(file_path, media_type=content_type or "application/octet-stream")


@app.post("/api/folders", tags=["notes"], status_code=201)
def create_folder(payload: CreateFolderRequest) -> Dict[str, Any]:
    try:
        folder = _resolve_relative_path(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    folder.mkdir(parents=True, exist_ok=True)
    gitkeep = folder / ".gitkeep"
    if not gitkeep.exists():
        gitkeep.write_text("", encoding="utf8")

    return {
        "path": _relative_to_notes_root(folder),
        "name": folder.name,
    }


@app.post("/api/notes", tags=["notes"], status_code=201)
def create_note(payload: CreateNoteRequest) -> Dict[str, Any]:
    note_path = payload.path
    if not note_path.endswith(NOTE_FILE_EXTENSION):
        note_path = f"{note_path}{NOTE_FILE_EXTENSION}"

    try:
        note_file = _resolve_relative_path(note_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if note_file.exists():
        raise HTTPException(status_code=409, detail="Note already exists")

    note_file.parent.mkdir(parents=True, exist_ok=True)
    content = payload.content or ""
    note_file.write_text(content, encoding="utf8")

    return {
        "path": _relative_to_notes_root(note_file),
        "name": note_file.name,
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
