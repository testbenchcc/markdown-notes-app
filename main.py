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
import logging
import mimetypes
import os
import re
import shutil
import threading
import time
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote, unquote

import markdown
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, conint

from git_versioning import (
    add_gitignore_pattern,
    commit_and_push_notes,
    commit_notes_only,
    pull_notes_with_rebase,
    push_notes,
    remove_gitignore_pattern,
)


APP_ROOT = Path(__file__).resolve().parent
logger = logging.getLogger("markdown_notes_app")


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
    theme: str = "base"
    indexPageTitle: str = "NoteBooks"
    imageStorageMode: str = "local"
    imageStorageSubfolder: str = "Images"
    imageLocalSubfolderName: str = "Images"
    imageFitToNoteWidth: bool = True
    imageMaxWidth: conint(gt=0) = 768
    imageMaxHeight: conint(gt=0) = 768
    imageMaxPasteBytes: Optional[conint(gt=0)] = None

    autoCommitEnabled: bool = False
    autoCommitIntervalSeconds: Optional[conint(gt=0)] = None
    autoPullEnabled: bool = False
    autoPullIntervalSeconds: Optional[conint(gt=0)] = None
    autoPushEnabled: bool = False
    autoPushIntervalSeconds: Optional[conint(gt=0)] = None

    timeZone: Optional[str] = None

    model_config = ConfigDict(extra="ignore")


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
        return NotebookSettings.model_validate(data)
    except Exception:  # pragma: no cover - defensive fallback
        return _DEFAULT_SETTINGS


def _save_settings(settings: NotebookSettings) -> None:
    cfg = get_config()
    path = cfg.settings_path
    path.parent.mkdir(parents=True, exist_ok=True)
    data = settings.model_dump(mode="json")
    path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf8")


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

DEFAULT_MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024

IMAGE_MARKDOWN_LINK_PATTERN = re.compile(r"\]\(\s*/files/([^)\s'\"#]+)")
IMAGE_HTML_TAG_PATTERN = re.compile(
    r"<img[^>]+src=['\"]\s*/files/([^'\">\s]+)",
    re.IGNORECASE,
)

SEARCH_MAX_MATCHES_PER_FILE = 20
SEARCH_MAX_RESULTS = 1000
SEARCH_MAX_QUERY_LENGTH = 200


_AUTO_SYNC_STATE: Dict[str, Dict[str, Any]] = {
    "commit": {
        "lastRunStartedAt": None,
        "lastRunCompletedAt": None,
        "lastStatus": "idle",
        "lastError": None,
        "lastResult": None,
    },
    "pull": {
        "lastRunStartedAt": None,
        "lastRunCompletedAt": None,
        "lastStatus": "idle",
        "lastError": None,
        "lastResult": None,
    },
    "push": {
        "lastRunStartedAt": None,
        "lastRunCompletedAt": None,
        "lastStatus": "idle",
        "lastError": None,
        "lastResult": None,
    },
    "conflict": {
        "active": False,
        "lastConflictAt": None,
        "conflictBranch": None,
        "lastError": None,
    },
}

_AUTO_SYNC_LOCK = threading.Lock()
_AUTO_SYNC_THREAD_STARTED = False

DEFAULT_AUTO_COMMIT_INTERVAL_SECONDS = 300
DEFAULT_AUTO_PULL_INTERVAL_SECONDS = 900
DEFAULT_AUTO_PUSH_INTERVAL_SECONDS = 900


def _auto_sync_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _run_auto_commit(notes_root: Path, remote_url: Optional[str]) -> None:
    started_at = _auto_sync_now_iso()

    with _AUTO_SYNC_LOCK:
        entry = _AUTO_SYNC_STATE["commit"]
        entry["lastRunStartedAt"] = started_at
        entry["lastStatus"] = "running"
        entry["lastError"] = None

    result: Dict[str, Any] | None = None
    status = "error"
    error: Optional[str] = None

    try:
        result = commit_notes_only(notes_root=notes_root, remote_url=remote_url)
        committed = bool(result.get("committed"))
        status = "ok" if committed else "skipped"
    except Exception as exc:  # pragma: no cover - defensive fallback
        error = str(exc)
        status = "error"

    finished_at = _auto_sync_now_iso()

    with _AUTO_SYNC_LOCK:
        entry = _AUTO_SYNC_STATE["commit"]
        entry["lastRunCompletedAt"] = finished_at
        entry["lastStatus"] = status
        entry["lastResult"] = result
        entry["lastError"] = error

    logger.info(
        "auto-commit completed status=%s committed=%s error=%s",
        status,
        bool(result.get("committed")) if isinstance(result, dict) else None,
        error,
    )


def _run_auto_pull(notes_root: Path, remote_url: Optional[str]) -> None:
    started_at = _auto_sync_now_iso()

    with _AUTO_SYNC_LOCK:
        entry = _AUTO_SYNC_STATE["pull"]
        entry["lastRunStartedAt"] = started_at
        entry["lastStatus"] = "running"
        entry["lastError"] = None

    result: Dict[str, Any] | None = None
    status = "error"
    error: Optional[str] = None
    conflict_update: Dict[str, Any] | None = None

    try:
        result = pull_notes_with_rebase(notes_root=notes_root, remote_url=remote_url)
        status_value = str(result.get("status") or "unknown")
        status = status_value
        error = result.get("error")

        if status_value == "conflict":
            conflict_update = {
                "active": True,
                "lastConflictAt": started_at,
                "conflictBranch": result.get("conflictBranch"),
                "lastError": error,
            }
        elif status_value in {"ok", "skipped"}:
            conflict_update = {
                "active": False,
                "lastConflictAt": None,
                "conflictBranch": None,
                "lastError": None,
            }
    except Exception as exc:  # pragma: no cover - defensive fallback
        error = str(exc)
        status = "error"

    finished_at = _auto_sync_now_iso()

    with _AUTO_SYNC_LOCK:
        entry = _AUTO_SYNC_STATE["pull"]
        entry["lastRunCompletedAt"] = finished_at
        entry["lastStatus"] = status
        entry["lastResult"] = result
        entry["lastError"] = error

        if conflict_update is not None:
            conflict_entry = _AUTO_SYNC_STATE["conflict"]
            conflict_entry["active"] = conflict_update["active"]
            conflict_entry["lastConflictAt"] = conflict_update["lastConflictAt"]
            conflict_entry["conflictBranch"] = conflict_update["conflictBranch"]
            conflict_entry["lastError"] = conflict_update["lastError"]

    logger.info(
        "auto-pull completed status=%s conflict_active=%s error=%s",
        status,
        bool(_AUTO_SYNC_STATE["conflict"]["active"]),
        error,
    )


def _run_auto_push(notes_root: Path, remote_url: Optional[str]) -> None:
    started_at = _auto_sync_now_iso()

    with _AUTO_SYNC_LOCK:
        entry = _AUTO_SYNC_STATE["push"]
        entry["lastRunStartedAt"] = started_at
        entry["lastStatus"] = "running"
        entry["lastError"] = None

    result: Dict[str, Any] | None = None
    status = "error"
    error: Optional[str] = None

    try:
        result = push_notes(notes_root=notes_root, remote_url=remote_url)
        pushed = bool(result.get("pushed"))
        push_status = result.get("push") or {}
        inner_status = str(push_status.get("status") or "")

        if inner_status == "error":
            status = "error"
            detail = push_status.get("detail")
            error = str(detail) if detail is not None else None
        else:
            status = "ok" if pushed else "skipped"
    except Exception as exc:  # pragma: no cover - defensive fallback
        error = str(exc)
        status = "error"

    finished_at = _auto_sync_now_iso()

    with _AUTO_SYNC_LOCK:
        entry = _AUTO_SYNC_STATE["push"]
        entry["lastRunCompletedAt"] = finished_at
        entry["lastStatus"] = status
        entry["lastResult"] = result
        entry["lastError"] = error

    logger.info(
        "auto-push completed status=%s pushed=%s error=%s",
        status,
        bool(result.get("pushed")) if isinstance(result, dict) else None,
        error,
    )


def _auto_sync_loop() -> None:
    last_commit_run = 0.0
    last_pull_run = 0.0
    last_push_run = 0.0

    while True:
        try:
            settings = _load_settings()
        except Exception:
            time.sleep(5.0)
            continue

        cfg = get_config()
        notes_root = cfg.notes_root
        remote_url = os.getenv("NOTES_REPO_REMOTE_URL") or None
        now = time.time()

        if settings.autoCommitEnabled:
            commit_interval = (
                settings.autoCommitIntervalSeconds
                or DEFAULT_AUTO_COMMIT_INTERVAL_SECONDS
            )
            if now - last_commit_run >= commit_interval:
                _run_auto_commit(notes_root, remote_url)
                last_commit_run = now

        if settings.autoPullEnabled:
            pull_interval = (
                settings.autoPullIntervalSeconds
                or DEFAULT_AUTO_PULL_INTERVAL_SECONDS
            )
            if now - last_pull_run >= pull_interval:
                _run_auto_pull(notes_root, remote_url)
                last_pull_run = now

        if settings.autoPushEnabled:
            push_interval = (
                settings.autoPushIntervalSeconds
                or DEFAULT_AUTO_PUSH_INTERVAL_SECONDS
            )
            if now - last_push_run >= push_interval:
                with _AUTO_SYNC_LOCK:
                    conflict_active = bool(_AUTO_SYNC_STATE["conflict"]["active"])
                    last_pull_status = str(_AUTO_SYNC_STATE["pull"]["lastStatus"])
                    last_commit_status = str(_AUTO_SYNC_STATE["commit"]["lastStatus"])

                should_push = True
                skip_reason: Optional[str] = None

                if conflict_active:
                    should_push = False
                    skip_reason = "conflict-active"
                elif last_pull_status not in {"ok", "skipped"}:
                    should_push = False
                    skip_reason = "pull-not-ok"
                elif last_commit_status not in {"ok", "skipped"}:
                    should_push = False
                    skip_reason = "commit-not-ok"

                if should_push:
                    _run_auto_push(notes_root, remote_url)
                else:
                    skipped_at = _auto_sync_now_iso()
                    with _AUTO_SYNC_LOCK:
                        entry = _AUTO_SYNC_STATE["push"]
                        entry["lastRunStartedAt"] = skipped_at
                        entry["lastRunCompletedAt"] = skipped_at
                        entry["lastStatus"] = "skipped"
                        entry["lastError"] = None
                        entry["lastResult"] = {
                            "pushed": False,
                            "reason": skip_reason or "preconditions-not-met",
                        }

                last_push_run = now

        time.sleep(1.0)


def _validate_relative_path(path_str: str) -> str:
    raw = path_str.strip()
    if not raw:
        raise ValueError("Path must not be empty")

    if raw.startswith(("/", "\\")):
        raise ValueError("Path must be relative and must not start with a path separator")

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


def _normalize_storage_component(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return "Images"
    return raw.strip("/\\")


def _build_image_relative_path(note_path: str, original_filename: str, settings: NotebookSettings) -> str:
    safe_note_rel = _validate_relative_path(note_path)
    note_rel_path = Path(safe_note_rel)
    note_parent = note_rel_path.parent.as_posix()

    ext = Path(original_filename or "image").suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        ext = ".png"

    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    stem = note_rel_path.stem or "image"
    safe_stem = "".join(ch for ch in stem if ch.isalnum() or ch in ("-", "_")) or "image"
    filename = f"{safe_stem}-{timestamp}{ext}"

    mode = (settings.imageStorageMode or "local").lower()
    if mode not in {"local", "flat", "matched"}:
        mode = "local"

    if mode == "flat":
        base = _normalize_storage_component(settings.imageStorageSubfolder)
        rel_dir = base
    elif mode == "matched":
        base = _normalize_storage_component(settings.imageStorageSubfolder)
        rel_dir = f"{base}/{note_parent}" if note_parent else base
    else:
        local_folder = _normalize_storage_component(settings.imageLocalSubfolderName)
        rel_dir = f"{note_parent}/{local_folder}" if note_parent else local_folder

    return f"{rel_dir}/{filename}" if rel_dir else filename


def _collect_referenced_image_paths(root: Path) -> set[str]:
    referenced: set[str] = set()

    for note_file in root.rglob(f"*{NOTE_FILE_EXTENSION}"):
        try:
            text = note_file.read_text(encoding="utf8")
        except OSError:
            continue

        for match in IMAGE_MARKDOWN_LINK_PATTERN.finditer(text):
            rel_path = match.group(1).strip()
            if rel_path:
                referenced.add(rel_path)

        for match in IMAGE_HTML_TAG_PATTERN.finditer(text):
            rel_path = match.group(1).strip()
            if rel_path:
                referenced.add(rel_path)

    return referenced


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


class CommitAndPushRequest(BaseModel):
    message: Optional[str] = None


class GitignorePatternRequest(BaseModel):
    pattern: str


app = FastAPI(title="Markdown Notes App", version="0.1.0")


@app.on_event("startup")
def _start_auto_sync_background() -> None:  # pragma: no cover - integration behavior
    global _AUTO_SYNC_THREAD_STARTED

    with _AUTO_SYNC_LOCK:
        if _AUTO_SYNC_THREAD_STARTED:
            return

        thread = threading.Thread(
            target=_auto_sync_loop,
            name="notes-auto-sync-worker",
            daemon=True,
        )
        thread.start()
        _AUTO_SYNC_THREAD_STARTED = True


STATIC_DIR = APP_ROOT / "static"
MONACO_STATIC_DIR = APP_ROOT / "node_modules" / "monaco-editor" / "min"
MARKDOWN_IT_STATIC_DIR = APP_ROOT / "node_modules" / "markdown-it" / "dist"
JQUERY_STATIC_DIR = APP_ROOT / "node_modules" / "jquery" / "dist"
JQUERY_UI_STATIC_DIR = APP_ROOT / "node_modules" / "jquery-ui" / "dist"
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

if JQUERY_STATIC_DIR.is_dir():
    app.mount("/vendor/jquery", StaticFiles(directory=JQUERY_STATIC_DIR), name="jquery")

if JQUERY_UI_STATIC_DIR.is_dir():
    app.mount("/vendor/jquery-ui", StaticFiles(directory=JQUERY_UI_STATIC_DIR), name="jquery_ui")

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
    return {"settings": settings.model_dump()}


@app.put("/api/settings", tags=["settings"])
def update_settings(payload: NotebookSettings) -> Dict[str, Any]:
    merged_data = {**_DEFAULT_SETTINGS.model_dump(), **payload.model_dump()}
    settings = NotebookSettings.model_validate(merged_data)
    _save_settings(settings)
    return {"settings": settings.model_dump()}


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


class PasteImageResponse(BaseModel):
    path: str
    markdown: str
    size: int


class ImageCleanupSummary(BaseModel):
    dryRun: bool
    totalImages: int
    referencedImages: int
    unusedImages: int
    removedPaths: List[str]
    candidatePaths: List[str]


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


@app.post("/api/images/paste", tags=["files"], response_model=PasteImageResponse)
async def paste_image(note_path: str = Form(...), file: UploadFile = File(...)) -> PasteImageResponse:
    settings = _load_settings()

    try:
        _validate_relative_path(note_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    content_type = (file.content_type or "").lower()
    filename = file.filename or "pasted-image"
    suffix = Path(filename).suffix.lower()

    if suffix not in IMAGE_EXTENSIONS and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Unsupported image type")

    raw = await file.read()
    size = len(raw)
    if size == 0:
        raise HTTPException(status_code=400, detail="Empty image upload")

    max_bytes = settings.imageMaxPasteBytes or DEFAULT_MAX_PASTED_IMAGE_BYTES
    if size > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Image is too large ({size} bytes); maximum allowed is {max_bytes} bytes",
        )

    rel_image_path = _build_image_relative_path(note_path, filename, settings)

    try:
        image_path = _resolve_relative_path(rel_image_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(raw)

    encoded_path = quote(rel_image_path, safe="/")
    markdown_snippet = f"![image](/files/{encoded_path})"

    return PasteImageResponse(path=rel_image_path, markdown=markdown_snippet, size=size)


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


@app.post("/api/images/cleanup", tags=["files"])
def cleanup_images(dryRun: bool = True) -> ImageCleanupSummary:
    cfg = get_config()
    root = cfg.notes_root

    referenced = _collect_referenced_image_paths(root)

    all_images: List[Path] = []
    for image_file in root.rglob("*"):
        if image_file.is_file() and image_file.suffix.lower() in IMAGE_EXTENSIONS:
            all_images.append(image_file)

    unused_files: List[Path] = []
    candidate_paths: List[str] = []
    removed_paths: List[str] = []

    for image_file in all_images:
        rel_path = _relative_to_notes_root(image_file)
        if rel_path not in referenced:
            unused_files.append(image_file)
            candidate_paths.append(rel_path)

    if not dryRun:
        for image_file in unused_files:
            rel_path = _relative_to_notes_root(image_file)
            try:
                image_file.unlink()
                removed_paths.append(rel_path)
            except OSError:
                continue

    return ImageCleanupSummary(
        dryRun=dryRun,
        totalImages=len(all_images),
        referencedImages=len(all_images) - len(candidate_paths),
        unusedImages=len(candidate_paths),
        removedPaths=removed_paths,
        candidatePaths=candidate_paths,
    )


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


@app.post("/api/versioning/notes/commit-and-push", tags=["versioning"])
def versioning_notes_commit_and_push(
    payload: CommitAndPushRequest | None = None,
) -> Dict[str, Any]:
    cfg = get_config()
    remote_url = os.getenv("NOTES_REPO_REMOTE_URL") or None

    try:
        result = commit_and_push_notes(
            notes_root=cfg.notes_root,
            remote_url=remote_url,
            commit_message=payload.message if payload else None,
        )
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.exception("manual commit-and-push failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    logger.info(
        "manual commit-and-push completed committed=%s pushed=%s",
        bool(result.get("committed")) if isinstance(result, dict) else None,
        bool(result.get("pushed")) if isinstance(result, dict) else None,
    )
    return result


@app.get("/api/versioning/notes/auto-sync-status", tags=["versioning"])
def versioning_notes_auto_sync_status() -> Dict[str, Any]:
    settings = _load_settings()

    with _AUTO_SYNC_LOCK:
        state = json.loads(json.dumps(_AUTO_SYNC_STATE))

    return {
        "settings": {
            "autoCommitEnabled": settings.autoCommitEnabled,
            "autoCommitIntervalSeconds": settings.autoCommitIntervalSeconds,
            "autoPullEnabled": settings.autoPullEnabled,
            "autoPullIntervalSeconds": settings.autoPullIntervalSeconds,
            "autoPushEnabled": settings.autoPushEnabled,
            "autoPushIntervalSeconds": settings.autoPushIntervalSeconds,
            "timeZone": settings.timeZone,
        },
        "state": state,
    }


@app.post("/api/versioning/notes/pull", tags=["versioning"])
def versioning_notes_pull() -> Dict[str, Any]:
    cfg = get_config()
    remote_url = os.getenv("NOTES_REPO_REMOTE_URL") or None

    try:
        result = pull_notes_with_rebase(notes_root=cfg.notes_root, remote_url=remote_url)
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.exception("manual pull failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    logger.info("manual pull completed status=%s", str(result.get("status")) if isinstance(result, dict) else None)
    return result


@app.post("/api/versioning/notes/gitignore/add", tags=["versioning"])
def versioning_notes_gitignore_add(payload: GitignorePatternRequest) -> Dict[str, Any]:
    cfg = get_config()

    try:
        result = add_gitignore_pattern(cfg.notes_root, payload.pattern)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return result


@app.post("/api/versioning/notes/gitignore/remove", tags=["versioning"])
def versioning_notes_gitignore_remove(payload: GitignorePatternRequest) -> Dict[str, Any]:
    cfg = get_config()

    try:
        result = remove_gitignore_pattern(cfg.notes_root, payload.pattern)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return result


class SearchResultLine(BaseModel):
    path: str
    lineNumber: int
    lineText: str


@app.get("/api/search", tags=["search"])
def search_notes(q: str) -> Dict[str, Any]:
    query = q.strip()
    if not query:
        return {"query": query, "results": []}
    if len(query) > SEARCH_MAX_QUERY_LENGTH:
        raise HTTPException(status_code=400, detail="Query too long")

    cfg = get_config()
    root = cfg.notes_root

    results: List[Dict[str, Any]] = []
    total_results = 0

    lower_query = query.lower()

    for note_file in root.rglob(f"*{NOTE_FILE_EXTENSION}"):
        try:
            rel_path = note_file.relative_to(root).as_posix()
        except ValueError:
            continue

        parts = note_file.relative_to(root).parts
        if any(part.startswith(".") for part in parts):
            continue

        try:
            text = note_file.read_text(encoding="utf8")
        except OSError:
            continue

        per_file_count = 0
        for index, line in enumerate(text.splitlines(), start=1):
            if lower_query in line.lower():
                results.append(
                    SearchResultLine(
                        path=rel_path,
                        lineNumber=index,
                        lineText=line,
                    ).model_dump()
                )
                per_file_count += 1
                total_results += 1

                if per_file_count >= SEARCH_MAX_MATCHES_PER_FILE:
                    break
                if total_results >= SEARCH_MAX_RESULTS:
                    break

        if total_results >= SEARCH_MAX_RESULTS:
            break

    return {"query": query, "results": results}


if __name__ == "__main__":  # pragma: no cover - manual/dev entrypoint
    # This allows `python main.py` in addition to `uvicorn main:app`.
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("UVICORN_RELOAD", "true").lower() == "true",
    )
