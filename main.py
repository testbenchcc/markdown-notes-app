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

import io
import json
import os
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import markdown
from fastapi import FastAPI, HTTPException, Query, File, UploadFile
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
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


class RenamePathRequest(BaseModel):
    old_path: str
    new_path: str


class DeletePathRequest(BaseModel):
    path: str


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


def _resolve_destination_path(relative_path: str) -> Path:
    """Resolve a destination path under NOTES_ROOT without requiring it to exist."""

    safe_rel = _validate_relative_path(relative_path)
    base = NOTES_ROOT.resolve()
    full = (base / safe_rel).resolve()

    if base not in full.parents and full != base:
        raise HTTPException(status_code=400, detail="Path escapes notes root")

    return full


def get_git_last_commit_timestamp(path: Path) -> int | None:
    try:
        rel = path.relative_to(APP_ROOT)
    except ValueError:
        return None
    try:
        completed = subprocess.run(
            ["git", "log", "-1", "--format=%ct", "--", str(rel)],
            cwd=str(APP_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except Exception:
        return None
    output = completed.stdout.strip()
    if not output:
        return None
    try:
        return int(output.splitlines()[0])
    except Exception:
        return None


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
    html = markdown.markdown(
        raw,
        extensions=["extra", "codehilite"],
        extension_configs={"codehilite": {"guess_lang": False, "noclasses": True}},
    )

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


@app.get("/api/search")
async def search_notes(q: str = Query(..., min_length=1, max_length=200)) -> Dict[str, Any]:
    """Search across all markdown notes for a simple text query.

    Returns a list of notes with matching lines.
    """

    ensure_notes_root()
    query = q.strip()
    if not query:
        return {"query": query, "results": []}

    lowered = query.lower()
    results = []

    for path in NOTES_ROOT.rglob("*.md"):
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue

        matches = []
        for index, line in enumerate(text.splitlines(), start=1):
            if lowered in line.lower():
                matches.append({"line_number": index, "line": line.strip()})
                if len(matches) >= 5:
                    break

        if matches:
            rel_path = path.relative_to(NOTES_ROOT).as_posix()
            results.append({"path": rel_path, "name": path.name, "matches": matches})

    results.sort(key=lambda item: item["path"].lower())

    return {"query": query, "results": results}


@app.post("/api/rename")
async def rename_path(payload: RenamePathRequest) -> Dict[str, Any]:
    """Rename or move a note or folder within the notes root."""

    ensure_notes_root()
    if not payload.old_path.strip():
        raise HTTPException(status_code=400, detail="Source path must not be empty")

    src = _resolve_relative_path(payload.old_path)
    dst = _resolve_destination_path(payload.new_path)

    base = NOTES_ROOT.resolve()
    if src == base:
        raise HTTPException(status_code=400, detail="Cannot rename notes root")

    if not src.exists():
        raise HTTPException(status_code=404, detail="Source path not found")
    if dst.exists():
        raise HTTPException(status_code=400, detail="Destination already exists")

    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)

    rel_src = src.relative_to(NOTES_ROOT).as_posix()
    rel_dst = dst.relative_to(NOTES_ROOT).as_posix()

    return {"ok": True, "from": rel_src, "to": rel_dst}


@app.post("/api/delete")
async def delete_path(payload: DeletePathRequest) -> Dict[str, Any]:
    """Delete a note or folder (recursively) under the notes root."""

    ensure_notes_root()
    if not payload.path.strip():
        raise HTTPException(status_code=400, detail="Path must not be empty")

    target = _resolve_relative_path(payload.path)
    base = NOTES_ROOT.resolve()
    if target == base:
        raise HTTPException(status_code=400, detail="Cannot delete notes root")

    if not target.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()

    rel = target.relative_to(NOTES_ROOT).as_posix()

    return {"ok": True, "path": rel}


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


@app.get("/api/export")
async def export_notebook() -> StreamingResponse:
    ensure_notes_root()
    buffer = io.BytesIO()
    notes_meta: Dict[str, Dict[str, int]] = {}
    include_names = [
        ".git",
        "static",
        "docker-compose.yml",
        "Dockerfile",
        "main.py",
        "requirements.txt",
    ]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in include_names:
            path = APP_ROOT / name
            if not path.exists():
                continue
            if path.is_dir():
                for root, _, files in os.walk(path):
                    root_path = Path(root)
                    for filename in files:
                        file_path = root_path / filename
                        arcname = file_path.relative_to(APP_ROOT).as_posix()
                        archive.write(file_path, arcname)
            else:
                arcname = path.relative_to(APP_ROOT).as_posix()
                archive.write(path, arcname)
        notes_root = NOTES_ROOT.resolve()
        if notes_root.is_dir():
            for item in notes_root.rglob("*"):
                if not item.is_file():
                    continue
                rel = item.relative_to(notes_root).as_posix()
                arcname = (Path("notes") / rel).as_posix()
                archive.write(item, arcname)
                ts = get_git_last_commit_timestamp(item)
                if ts is None:
                    try:
                        ts = int(item.stat().st_mtime)
                    except Exception:
                        ts = None
                if ts is not None:
                    notes_meta[arcname] = {"commit_timestamp": ts}
        meta = {
            "version": 1,
            "generated_at": int(datetime.now(tz=timezone.utc).timestamp()),
            "notes": notes_meta,
        }
        archive.writestr(
            ".notebook-export-meta.json",
            json.dumps(meta, ensure_ascii=False),
        )
    buffer.seek(0)
    headers = {
        "Content-Disposition": 'attachment; filename="markdown-notes-notebook.zip"'
    }
    return StreamingResponse(buffer, media_type="application/zip", headers=headers)


@app.post("/api/import")
async def import_notebook(
    file: UploadFile = File(...),
    force: bool = False,
):
    ensure_notes_root()
    if not file.filename:
        raise HTTPException(status_code=400, detail="File is required")
    data = await file.read()
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")
    try:
        raw_meta = archive.read(".notebook-export-meta.json")
        meta = json.loads(raw_meta.decode("utf-8"))
        notes_meta = meta.get("notes") or {}
    except KeyError:
        notes_meta = {}
    except Exception:
        notes_meta = {}
    plan = []
    for info in archive.infolist():
        name = info.filename
        normalized = name.replace("\\", "/")
        if not normalized.startswith("notes/"):
            continue
        subpath = normalized[len("notes/") :]
        if not subpath:
            continue
        parts = [p for p in subpath.split("/") if p]
        if any(part == ".." for part in parts):
            archive.close()
            raise HTTPException(status_code=400, detail="Invalid path in archive")
        is_dir = info.is_dir()
        rel_subpath = "/".join(parts)
        if is_dir:
            plan.append({"type": "dir", "subpath": rel_subpath})
        else:
            plan.append(
                {
                    "type": "file",
                    "subpath": rel_subpath,
                    "zip_name": name,
                    "info": info,
                }
            )
    older_conflicts = []
    for item in plan:
        if item["type"] != "file":
            continue
        subpath = item["subpath"]
        target = _resolve_destination_path(subpath)
        if not target.exists():
            continue
        meta_key = f"notes/{subpath}"
        imported_meta = notes_meta.get(meta_key) or {}
        imported_ts = imported_meta.get("commit_timestamp")
        if imported_ts is None:
            try:
                dt = datetime(*item["info"].date_time, tzinfo=timezone.utc)
                imported_ts = int(dt.timestamp())
            except Exception:
                imported_ts = None
        current_ts = get_git_last_commit_timestamp(target)
        if current_ts is None:
            try:
                current_ts = int(target.stat().st_mtime)
            except Exception:
                current_ts = None
        if (
            imported_ts is not None
            and current_ts is not None
            and imported_ts < current_ts
            and not force
        ):
            older_conflicts.append(
                {
                    "path": subpath,
                    "current_timestamp": current_ts,
                    "imported_timestamp": imported_ts,
                }
            )
    if older_conflicts and not force:
        archive.close()
        return JSONResponse(
            status_code=409,
            content={
                "reason": "older_notes",
                "conflicts": older_conflicts,
            },
        )
    for item in plan:
        subpath = item["subpath"]
        target = _resolve_destination_path(subpath)
        if item["type"] == "dir":
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(item["zip_name"]) as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    archive.close()
    return {"ok": True}
