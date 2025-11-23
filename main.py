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
import re
import secrets
import shutil
import base64
import hashlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse, parse_qs
import html as html_module

from dotenv import load_dotenv
import markdown
import requests
from fastapi import FastAPI, HTTPException, Query, File, UploadFile, Form
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Determine application root based on this file location.
APP_ROOT = Path(__file__).resolve().parent
load_dotenv()

BASE_THEME_CSS_PATH = APP_ROOT / "static" / "styles.css"

EXPORT_THEME_CSS_MAP: Dict[str, Path] = {
    "gruvbox-dark": BASE_THEME_CSS_PATH,
    "office": APP_ROOT / "static" / "styles-office.css",
    "high-contrast": APP_ROOT / "static" / "styles-high-contrast.css",
    "midnight": APP_ROOT / "static" / "styles-midnight.css",
}

DEFAULT_EXPORT_THEME_ID = "office"

MERMAID_JS_PATH = APP_ROOT / "static" / "mermaid.min.js"

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
ALLOWED_IMAGE_MIME_TYPES: Dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}

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

SETTINGS_FILE_NAME = ".notebook-settings.json"

NOTES_REPO_REMOTE_URL = os.getenv("NOTES_REPO_REMOTE_URL")
APP_REPO_REMOTE_URL = os.getenv("APP_REPO_REMOTE_URL")

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


class GitignorePathRequest(BaseModel):
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


def _preprocess_mermaid_fences(text: str) -> str:
    """Rewrite ```mermaid fenced blocks into <div class="mermaid"> blocks.

    This allows the frontend to simply run Mermaid on `.mermaid` elements
    without needing to inspect markdown code blocks.
    """

    if not text:
        return text

    pattern = re.compile(r"```mermaid\s*\n(.*?)\n```", re.IGNORECASE | re.DOTALL)

    def _replace(match: re.Match[str]) -> str:
        body = match.group(1)
        return f"<div class=\"mermaid\">\n{body}\n</div>"

    return pattern.sub(_replace, text)


def _render_markdown_html(text: str, tab_length: int | None = None) -> str:
    processed = _preprocess_mermaid_fences(text)
    effective_tab_length: int
    try:
        if tab_length is None:
            effective_tab_length = 2
        else:
            value = int(tab_length)
            effective_tab_length = value if value > 0 else 2
    except (TypeError, ValueError):
        effective_tab_length = 2

    return markdown.markdown(
        processed,
        extensions=["extra", "codehilite", "pymdownx.tasklist"],
        extension_configs={
            "codehilite": {"guess_lang": False, "noclasses": True},
            "pymdownx.tasklist": {"clickable_checkbox": False},
        },
        tab_length=effective_tab_length,
    )


class NotebookSettings(BaseModel):
    editorSpellcheck: bool = False
    theme: str = "gruvbox-dark"
    exportTheme: str = "match-app-theme"
    autoCommitNotes: bool = False
    autoPullNotes: bool = False
    autoPullIntervalMinutes: int = 30
    autoSaveIntervalSeconds: int = 60
    tabLength: int = 2
    indexPageTitle: str = "NoteBooks"
    imageStoragePath: str = "images"
    imageMaxPasteBytes: int = 5 * 1024 * 1024
    imageDisplayMode: str = "fit-width"
    imageMaxDisplayWidth: int = 0
    imageMaxDisplayHeight: int = 0
    imageDefaultAlignment: str = "left"
    dateFormat: str = "YYYY-MM-DD"
    timeFormat: str = "HH:mm"

    class Config:
        extra = "ignore"


def _get_settings_file_path() -> Path:
    ensure_notes_root()
    return NOTES_ROOT / SETTINGS_FILE_NAME


def load_notebook_settings() -> Dict[str, Any]:
    base = NotebookSettings().dict()
    path = _get_settings_file_path()
    if not path.is_file():
        return base
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception:
        return base
    try:
        data = json.loads(raw)
    except Exception:
        return base
    if isinstance(data, dict):
        try:
            model = NotebookSettings(**data)
        except Exception:
            return base
        merged = {**base, **model.dict()}
        return merged
    return base


def save_notebook_settings(data: Dict[str, Any]) -> Dict[str, Any]:
    base = NotebookSettings().dict()
    try:
        model = NotebookSettings(**data)
        merged = {**base, **model.dict()}
    except Exception:
        merged = base
    path = _get_settings_file_path()
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def _resolve_destination_path(relative_path: str) -> Path:
    """Resolve a destination path under NOTES_ROOT without requiring it to exist."""

    safe_rel = _validate_relative_path(relative_path)
    base = NOTES_ROOT.resolve()
    full = (base / safe_rel).resolve()

    if base not in full.parents and full != base:
        raise HTTPException(status_code=400, detail="Path escapes notes root")

    return full


def _guess_image_mime_type(path: Path) -> str:
    ext = path.suffix.lower()
    return ALLOWED_IMAGE_MIME_TYPES.get(ext, "application/octet-stream")


def _is_managed_notes_rel_path(rel_path: str) -> bool:
    """Return True if the given NOTES_ROOT-relative path should be synced via GitHub.

    We include markdown notes, allowed image formats, and a small set of
    configuration files (.notebook-settings.json, .gitignore, .gitkeep).
    Files under hidden directories (e.g. .git) are excluded.
    """

    rel = rel_path.strip().lstrip("/\\")
    if not rel:
        return False

    parts = [p for p in rel.split("/") if p]
    if not parts:
        return False

    name = parts[-1]
    if name in {SETTINGS_FILE_NAME, ".gitignore", ".gitkeep"}:
        return True

    suffix = Path(name).suffix.lower()
    if suffix != ".md" and suffix not in ALLOWED_IMAGE_EXTENSIONS:
        return False

    for part in parts[:-1]:
        if part.startswith("."):
            return False

    return True


def _iter_local_notes_sync_paths() -> list[tuple[Path, str]]:
    """Return a list of (path, rel_path) for local notes files we manage via sync."""

    ensure_notes_root()
    base = NOTES_ROOT.resolve()
    results: list[tuple[Path, str]] = []

    for path in base.rglob("*"):
        if not path.is_file():
            continue
        try:
            rel = path.relative_to(base).as_posix()
        except Exception:
            continue
        if not _is_managed_notes_rel_path(rel):
            continue
        results.append((path, rel))

    return results


def _get_notes_repo_info(session: requests.Session) -> tuple[str, str, str]:
    """Resolve notes repo owner, name, and default branch from the remote URL."""

    remote_url = NOTES_REPO_REMOTE_URL
    if not remote_url:
        raise HTTPException(status_code=500, detail="Notes remote URL for GitHub not configured")

    try:
        owner, repo = _parse_github_remote_url(remote_url)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    repo_url = f"{GITHUB_API_URL}/repos/{owner}/{repo}"
    try:
        resp = session.get(repo_url)
        resp.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="GitHub API request failed")

    data = resp.json()
    default_branch = (data.get("default_branch") or "main").strip() or "main"
    return owner, repo, default_branch


def _fetch_github_tree_for_branch(
    session: requests.Session, owner: str, repo: str, branch: str
) -> dict[str, str]:
    """Fetch a mapping of path -> blob sha for the given branch.

    Only includes files that we manage for notes sync.
    """

    url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/git/trees/{branch}"
    try:
        resp = session.get(url, params={"recursive": 1})
        resp.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="GitHub API request failed")

    body = resp.json()
    tree = body.get("tree") or []
    items: dict[str, str] = {}

    for entry in tree:
        if not isinstance(entry, dict):
            continue
        if (entry.get("type") or "") != "blob":
            continue
        path = (entry.get("path") or "").strip()
        if not path or not _is_managed_notes_rel_path(path):
            continue
        sha = (entry.get("sha") or "").strip()
        if not sha:
            continue
        items[path] = sha

    return items


def _compute_git_blob_sha(content: bytes) -> str:
    """Compute the Git blob SHA1 for the given content."""

    header = f"blob {len(content)}\0".encode("utf-8")
    return hashlib.sha1(header + content).hexdigest()


def auto_commit_and_push_notes() -> Dict[str, Any]:
    """Synchronise local notes changes to the GitHub notes repository.

    Uses the GitHub Contents API instead of the local git CLI. All changes are
    committed directly to the repository's default branch.
    """

    ensure_notes_root()

    session = _make_github_session()
    owner, repo, branch = _get_notes_repo_info(session)
    remote_files = _fetch_github_tree_for_branch(session, owner, repo, branch)

    local_entries = _iter_local_notes_sync_paths()
    local_index: dict[str, tuple[Path, str]] = {}

    for path, rel in local_entries:
        try:
            data = path.read_bytes()
        except Exception:
            continue
        sha = _compute_git_blob_sha(data)
        local_index[rel] = (path, sha)

    to_create: list[tuple[str, bytes]] = []
    to_update: list[tuple[str, bytes, str]] = []

    for rel, (path, local_sha) in local_index.items():
        remote_sha = remote_files.get(rel)
        if remote_sha is None:
            try:
                data = path.read_bytes()
            except Exception:
                continue
            to_create.append((rel, data))
        elif remote_sha != local_sha:
            try:
                data = path.read_bytes()
            except Exception:
                continue
            to_update.append((rel, data, remote_sha))

    to_delete: list[tuple[str, str]] = []
    for rel, remote_sha in remote_files.items():
        if rel not in local_index:
            to_delete.append((rel, remote_sha))

    if not to_create and not to_update and not to_delete:
        return {"ok": True, "committed": False, "pushed": False, "reason": "no_changes"}

    commit_message = f"Auto-commit notes at {datetime.now(tz=timezone.utc).isoformat()}"
    created = 0
    updated = 0
    deleted = 0

    for rel, data in to_create:
        encoded = base64.b64encode(data).decode("ascii")
        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/contents/{rel}"
        try:
            resp = session.put(
                url,
                json={
                    "message": commit_message,
                    "content": encoded,
                    "branch": branch,
                },
            )
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="GitHub API request failed")
        if resp.status_code == 201:
            created += 1
            continue
        if resp.status_code == 409:
            raise HTTPException(
                status_code=409,
                detail="Failed to commit notes changes due to a conflict",
            )
        try:
            resp.raise_for_status()
        except requests.HTTPError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        raise HTTPException(status_code=502, detail="GitHub API request failed")

    for rel, data, remote_sha in to_update:
        encoded = base64.b64encode(data).decode("ascii")
        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/contents/{rel}"
        try:
            resp = session.put(
                url,
                json={
                    "message": commit_message,
                    "content": encoded,
                    "sha": remote_sha,
                    "branch": branch,
                },
            )
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="GitHub API request failed")
        if resp.status_code in (200, 201):
            updated += 1
            continue
        if resp.status_code == 409:
            raise HTTPException(
                status_code=409,
                detail="Failed to commit notes changes due to a conflict",
            )
        try:
            resp.raise_for_status()
        except requests.HTTPError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        raise HTTPException(status_code=502, detail="GitHub API request failed")

    for rel, remote_sha in to_delete:
        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/contents/{rel}"
        try:
            resp = session.delete(
                url,
                json={
                    "message": commit_message,
                    "sha": remote_sha,
                    "branch": branch,
                },
            )
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="GitHub API request failed")
        if resp.status_code in (200, 204):
            deleted += 1
            continue
        if resp.status_code == 409:
            raise HTTPException(
                status_code=409,
                detail="Failed to remove notes files due to a conflict",
            )
        try:
            resp.raise_for_status()
        except requests.HTTPError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        raise HTTPException(status_code=502, detail="GitHub API request failed")

    return {
        "ok": True,
        "committed": True,
        "pushed": True,
        "reason": "github_api",
        "stats": {
            "created": created,
            "updated": updated,
            "deleted": deleted,
        },
    }


def auto_pull_notes() -> Dict[str, Any]:
    """Pull latest notes from the GitHub notes repository into the local tree."""

    ensure_notes_root()

    commit_result = auto_commit_and_push_notes()

    session = _make_github_session()
    owner, repo, branch = _get_notes_repo_info(session)
    remote_files = _fetch_github_tree_for_branch(session, owner, repo, branch)

    local_entries = _iter_local_notes_sync_paths()
    local_paths: dict[str, Path] = {rel: path for (path, rel) in local_entries}

    updated = 0
    deleted_local = 0

    for rel, remote_sha in remote_files.items():
        dest = _resolve_destination_path(rel)
        current_sha: str | None = None
        if dest.exists() and dest.is_file():
            try:
                current_data = dest.read_bytes()
            except Exception:
                current_data = b""
            current_sha = _compute_git_blob_sha(current_data)
        if current_sha == remote_sha:
            continue

        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/contents/{rel}"
        try:
            resp = session.get(url, params={"ref": branch})
            resp.raise_for_status()
        except requests.HTTPError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="GitHub API request failed")

        body = resp.json()
        encoded = (body.get("content") or "").strip()
        if not encoded:
            continue
        try:
            data = base64.b64decode(encoded, validate=False)
        except Exception:
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        updated += 1

    for rel, path in local_paths.items():
        if rel in remote_files:
            continue
        try:
            path.unlink()
            deleted_local += 1
        except Exception:
            continue

    return {
        "ok": True,
        "pulled": True,
        "updated": updated,
        "deleted_local": deleted_local,
        "commit_result": commit_result,
    }


def _get_notes_gitignore_path() -> Path:
    ensure_notes_root()
    return NOTES_ROOT / ".gitignore"


def _read_notes_gitignore_lines() -> list[str]:
    path = _get_notes_gitignore_path()
    if not path.is_file():
        return []
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception:
        return []
    return [line.rstrip("\r\n") for line in raw.splitlines()]


def _write_notes_gitignore_lines(lines: list[str]) -> None:
    path = _get_notes_gitignore_path()
    if not lines:
        path.write_text("", encoding="utf-8")
        return
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8")


GITHUB_API_URL = "https://api.github.com"


def _make_github_session() -> requests.Session:
    token = os.getenv("GITHUB_API_KEY")
    if not token:
        raise HTTPException(status_code=500, detail="GITHUB_API_KEY not configured")
    session = requests.Session()
    session.headers.update(
        {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "MarkdownNotesApp-Git-Info",
        }
    )
    return session


def _parse_github_remote_url(remote_url: str) -> tuple[str, str]:
    if not remote_url:
        raise ValueError("Empty remote URL")
    value = remote_url.strip()
    if value.endswith(".git"):
        value = value[:-4]
    if value.startswith("git@github.com:"):
        path = value.split(":", 1)[1]
    elif "github.com/" in value:
        path = value.split("github.com/", 1)[1]
    else:
        raise ValueError(f"Not a GitHub URL: {remote_url!r}")
    parts = [p for p in path.split("/") if p]
    if len(parts) < 2:
        raise ValueError(f"Cannot parse GitHub owner/repo from: {remote_url!r}")
    owner, repo = parts[0], parts[1]
    return owner, repo


def _fetch_github_commits(
    session: requests.Session, owner: str, repo: str, per_page: int = 20
) -> list[dict[str, Any]]:
    url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/commits"
    resp = session.get(url, params={"per_page": per_page})
    resp.raise_for_status()
    items: list[dict[str, Any]] = []
    for c in resp.json():
        sha = c.get("sha") or ""
        commit = c.get("commit") or {}
        msg = commit.get("message") or ""
        lines = msg.splitlines() or [""]
        items.append(
            {
                "short_sha": sha[:7],
                "full_sha": sha,
                "title": lines[0] if lines else "",
                "message": msg,
            }
        )
    return items


def _fetch_github_releases(
    session: requests.Session, owner: str, repo: str
) -> list[dict[str, Any]]:
    url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/releases"
    resp = session.get(url)
    resp.raise_for_status()
    items: list[dict[str, Any]] = []
    for r in resp.json():
        items.append(
            {
                "tag_name": r.get("tag_name", "") or "",
                "name": r.get("name", "") or "",
                "body": r.get("body", "") or "",
            }
        )
    return items


def _fetch_github_tags_with_messages(
    session: requests.Session, owner: str, repo: str
) -> list[dict[str, Any]]:
    url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/tags"
    resp = session.get(url)
    resp.raise_for_status()
    tags = resp.json()
    items: list[dict[str, Any]] = []
    for t in tags:
        tag_name = t.get("name", "") or ""
        commit = t.get("commit") or {}
        commit_sha = commit.get("sha", "") or ""
        tag_message = ""
        if commit_sha:
            tag_url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/git/tags/{commit_sha}"
            tag_resp = session.get(tag_url)
            if tag_resp.status_code == 200:
                tag_json = tag_resp.json()
                tag_message = tag_json.get("message", "") or ""
        items.append(
            {
                "name": tag_name,
                "commit_sha": commit_sha,
                "tag_message": tag_message,
            }
        )
    return items


def _fetch_github_commit_count(
    session: requests.Session, owner: str, repo: str
) -> int | None:
    repo_url = f"{GITHUB_API_URL}/repos/{owner}/{repo}"
    repo_resp = session.get(repo_url)
    repo_resp.raise_for_status()
    repo_data = repo_resp.json()
    default_branch = (repo_data.get("default_branch") or "main").strip() or "main"

    commits_url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/commits"
    commits_resp = session.get(
        commits_url, params={"per_page": 1, "sha": default_branch}
    )
    commits_resp.raise_for_status()

    link_header = commits_resp.headers.get("Link") or ""
    if link_header:
        for part in link_header.split(","):
            section = part.strip()
            if 'rel="last"' not in section:
                continue
            url_part = section.split(";", 1)[0].strip()
            if url_part.startswith("<") and url_part.endswith(">"):
                url_text = url_part[1:-1]
            else:
                url_text = url_part
            parsed = urlparse(url_text)
            query = parse_qs(parsed.query)
            pages = query.get("page")
            if not pages:
                continue
            try:
                return int(pages[0])
            except (TypeError, ValueError):
                return None

    body = commits_resp.json()
    if isinstance(body, list):
        return len(body)
    return None


def _fetch_latest_release_tag_name(
    session: requests.Session, owner: str, repo: str
) -> str | None:
    releases = _fetch_github_releases(session, owner, repo)
    for r in releases:
        tag_name = (r.get("tag_name") or "").strip()
        if tag_name:
            return tag_name
        name = (r.get("name") or "").strip()
        if name:
            return name

    tags = _fetch_github_tags_with_messages(session, owner, repo)
    for t in tags:
        name = (t.get("name") or "").strip()
        if name:
            return name

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
                name = child.name
                if name.startswith("."):
                    continue
                # Include markdown files, image files, and directories.
                if child.is_dir() or (
                    child.is_file()
                    and (
                        child.suffix.lower() == ".md"
                        or child.suffix.lower() in ALLOWED_IMAGE_EXTENSIONS
                    )
                ):
                    child_rel = rel / child.name if rel != Path("") else Path(child.name)
                    children.append(build_node(child, child_rel))

            return {
                "type": "folder",
                "name": path.name if rel != Path("") else "",
                "path": rel_str,
                "children": children,
            }

        # Leaf node: note or image
        suffix = path.suffix.lower()
        node_type = "note" if suffix == ".md" else "image"
        return {
            "type": node_type,
            "name": path.name,
            "path": rel_str,
        }

    return build_node(root_path)


app = FastAPI(title="Markdown Notes App", version="1.0.0")


@app.get("/api/settings")
async def get_notebook_settings() -> Dict[str, Any]:
    return load_notebook_settings()


@app.put("/api/settings")
async def update_notebook_settings(payload: NotebookSettings) -> Dict[str, Any]:
    data = payload.dict()
    saved = save_notebook_settings(data)
    return saved


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
    settings = load_notebook_settings()
    tab_length = settings.get("tabLength") if isinstance(settings, dict) else None
    html = _render_markdown_html(raw, tab_length=tab_length)

    rel_path = file_path.relative_to(NOTES_ROOT).as_posix()

    return {
        "path": rel_path,
        "name": file_path.name,
        "content": raw,
        "html": html,
    }


@app.get("/api/export-note/{note_path:path}")
async def export_note_html(note_path: str, theme: str | None = None) -> HTMLResponse:
    """Export a single markdown note as a standalone HTML document."""

    ensure_notes_root()
    file_path = _resolve_relative_path(note_path)

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Note not found")

    if file_path.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Not a markdown file")

    raw = file_path.read_text(encoding="utf-8")
    settings = load_notebook_settings()
    tab_length = settings.get("tabLength") if isinstance(settings, dict) else None
    body_html = _render_markdown_html(raw, tab_length=tab_length)

    title = file_path.stem or file_path.name
    safe_title = html_module.escape(title, quote=True)

    theme_id = (theme or "").strip() or DEFAULT_EXPORT_THEME_ID
    if theme_id not in EXPORT_THEME_CSS_MAP:
        theme_id = DEFAULT_EXPORT_THEME_ID

    css_parts: list[str] = []

    try:
        base_css = BASE_THEME_CSS_PATH.read_text(encoding="utf-8")
        css_parts.append(base_css)
    except Exception:
        pass

    if theme_id != DEFAULT_EXPORT_THEME_ID:
        variant_path = EXPORT_THEME_CSS_MAP.get(theme_id)
        if variant_path and variant_path != BASE_THEME_CSS_PATH:
            try:
                variant_css = variant_path.read_text(encoding="utf-8")
                filtered_lines = [
                    line
                    for line in variant_css.splitlines()
                    if not line.lstrip().lower().startswith("@import")
                ]
                css_parts.append("\n".join(filtered_lines))
            except Exception:
                pass

    css_text = "\n\n".join(css_parts)

    mermaid_js_text = ""
    try:
        mermaid_js_text = MERMAID_JS_PATH.read_text(encoding="utf-8")
    except Exception:
        mermaid_js_text = ""

    full_html = f"""<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>{safe_title}</title>
        <style>
    {css_text}
        </style>
        <script>
    {mermaid_js_text}
        </script>
      </head>
      <body>
        <div class="content-view">
    {body_html}
        </div>
        <script>
    (function() {{
      var mermaidGlobal = window.mermaid;
      if (!mermaidGlobal) {{
        return;
      }}
      try {{
        if (typeof mermaidGlobal.initialize === "function") {{
          mermaidGlobal.initialize({{ startOnLoad: false }});
        }}
        var targets = Array.prototype.slice.call(
          document.querySelectorAll(".mermaid")
        );
        if (!targets.length) {{
          return;
        }}
        if (typeof mermaidGlobal.init === "function") {{
          mermaidGlobal.init(undefined, targets);
        }} else if (typeof mermaidGlobal.run === "function") {{
          mermaidGlobal.run({{ nodes: targets }});
        }}
      }} catch (e) {{}}
    }})();
        </script>
      </body>
    </html>
    """

    base_name = file_path.stem or file_path.name
    safe_name = "".join(
        ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in base_name
    )
    if not safe_name:
        safe_name = "note"
    filename = f"{safe_name}.html"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"'
    }

    return HTMLResponse(content=full_html, media_type="text/html", headers=headers)


@app.put("/api/notes/{note_path:path}")
async def save_note(note_path: str, payload: SaveNoteRequest) -> Dict[str, Any]:
    """Create or overwrite a markdown note at the given relative path."""

    ensure_notes_root()
    file_path = _resolve_relative_path(note_path)

    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(payload.content, encoding="utf-8")

    rel_path = file_path.relative_to(NOTES_ROOT).as_posix()

    return {"ok": True, "path": rel_path, "name": file_path.name}


def _ensure_gitkeep_for_folder(folder_path: Path) -> None:
    try:
        base = NOTES_ROOT.resolve()
        current = folder_path.resolve()
    except Exception:
        return

    while True:
        if base not in current.parents and current != base:
            break
        gitkeep_path = current / ".gitkeep"
        if not gitkeep_path.exists():
            try:
                gitkeep_path.write_text("", encoding="utf-8")
            except Exception:
                pass
        if current == base:
            break
        current = current.parent


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
        rel_parts = path.relative_to(NOTES_ROOT).parts
        if any(part.startswith(".") for part in rel_parts):
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

    _ensure_gitkeep_for_folder(folder_path)

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
    _ensure_gitkeep_for_folder(file_path.parent)
    initial_content = payload.content or ""
    file_path.write_text(initial_content, encoding="utf-8")

    rel_path = file_path.relative_to(NOTES_ROOT).as_posix()

    return {"ok": True, "path": rel_path, "name": file_path.name}


@app.get("/files/{file_rel_path:path}", include_in_schema=False)
async def get_note_file(file_rel_path: str) -> FileResponse:
    ensure_notes_root()
    try:
        file_path = _resolve_relative_path(file_rel_path)
    except HTTPException:
        raise HTTPException(status_code=404, detail="File not found")

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    if file_path.suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    media_type = _guess_image_mime_type(file_path)
    return FileResponse(file_path, media_type=media_type)


@app.post("/api/images/paste")
async def upload_pasted_image(
    note_path: str = Form(...),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    ensure_notes_root()

    if not file.filename:
        raise HTTPException(status_code=400, detail="File is required")

    original_name = file.filename
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image format")

    settings = load_notebook_settings()
    storage_rel_raw = "images"
    if isinstance(settings, dict):
        value = settings.get("imageStoragePath")
        if isinstance(value, str) and value.strip():
            storage_rel_raw = value.strip()

    try:
        storage_rel = _validate_relative_path(storage_rel_raw)
    except HTTPException:
        storage_rel = "images"

    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    random_suffix = secrets.token_hex(2)
    filename = f"img-{timestamp}-{random_suffix}{ext}"
    relative_path = f"{storage_rel}/{filename}"

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")

    full_path = _resolve_destination_path(relative_path)
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(data)

    rel_for_markdown = full_path.relative_to(NOTES_ROOT).as_posix()
    markdown = f"![image](/files/{rel_for_markdown})"

    return {
        "ok": True,
        "path": rel_for_markdown,
        "markdown": markdown,
        "original_filename": original_name,
        "note_path": note_path,
    }


@app.post("/api/images/cleanup")
async def cleanup_images() -> Dict[str, Any]:
    ensure_notes_root()

    settings = load_notebook_settings()
    storage_rel_raw = "images"
    if isinstance(settings, dict):
        value = settings.get("imageStoragePath")
        if isinstance(value, str) and value.strip():
            storage_rel_raw = value.strip()

    try:
        storage_rel = _validate_relative_path(storage_rel_raw)
    except HTTPException:
        raise HTTPException(status_code=400, detail="Invalid image storage path")

    storage_root = _resolve_destination_path(storage_rel)
    if not storage_root.is_dir():
        return {"ok": True, "deleted": [], "kept": [], "total": 0}

    all_images: dict[str, Path] = {}
    for path in storage_root.rglob("*"):
        if path.is_file() and path.suffix.lower() in ALLOWED_IMAGE_EXTENSIONS:
            rel = path.relative_to(NOTES_ROOT).as_posix()
            all_images[rel] = path

    if not all_images:
        return {"ok": True, "deleted": [], "kept": [], "total": 0}

    pattern = re.compile(r"!\[[^\]]*]\(([^)]+)\)")
    referenced: set[str] = set()

    for note_path in NOTES_ROOT.rglob("*.md"):
        if not note_path.is_file():
            continue

        rel_parts = note_path.relative_to(NOTES_ROOT).parts
        if any(part.startswith(".") for part in rel_parts):
            continue

        try:
            text = note_path.read_text(encoding="utf-8")
        except Exception:
            continue

        for match in pattern.finditer(text):
            url = (match.group(1) or "").strip()
            if not url:
                continue

            if url.startswith("/files/"):
                candidate = url[len("/files/") :]
            else:
                continue

            try:
                safe_rel = _validate_relative_path(candidate)
            except HTTPException:
                continue

            if safe_rel in all_images:
                referenced.add(safe_rel)

    deleted: list[str] = []
    for rel, path in list(all_images.items()):
        if rel in referenced:
            continue
        try:
            path.unlink()
            deleted.append(rel)
        except Exception:
            continue

    kept = sorted(rel for rel in all_images.keys() if rel not in deleted)

    return {"ok": True, "deleted": sorted(deleted), "kept": kept, "total": len(all_images)}


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


@app.post("/api/versioning/notes/gitignore/add")
async def versioning_notes_gitignore_add(payload: GitignorePathRequest) -> Dict[str, Any]:
    ensure_notes_root()
    if not payload.path.strip():
        raise HTTPException(status_code=400, detail="Path must not be empty")

    safe_rel = _validate_relative_path(payload.path)
    existing = _read_notes_gitignore_lines()

    if safe_rel not in existing:
        next_lines = existing + [safe_rel]
        _write_notes_gitignore_lines(next_lines)
        added = True
    else:
        added = False

    return {"ok": True, "path": safe_rel, "added": added}


@app.post("/api/versioning/notes/gitignore/remove")
async def versioning_notes_gitignore_remove(payload: GitignorePathRequest) -> Dict[str, Any]:
    ensure_notes_root()
    if not payload.path.strip():
        raise HTTPException(status_code=400, detail="Path must not be empty")

    safe_rel = _validate_relative_path(payload.path)
    existing = _read_notes_gitignore_lines()
    if not existing:
        _write_notes_gitignore_lines(existing)
        return {"ok": True, "path": safe_rel, "removed": False}

    next_lines = [line for line in existing if line.strip() != safe_rel]
    removed = len(next_lines) < len(existing)
    _write_notes_gitignore_lines(next_lines)

    return {"ok": True, "path": safe_rel, "removed": removed}


@app.post("/api/versioning/notes/commit-and-push")
async def versioning_notes_commit_and_push() -> Dict[str, Any]:
    return auto_commit_and_push_notes()


@app.post("/api/versioning/notes/pull")
async def versioning_notes_pull() -> Dict[str, Any]:
    return auto_pull_notes()


@app.post("/api/versioning/app/pull")
async def versioning_app_pull() -> Dict[str, Any]:
    raise HTTPException(
        status_code=501,
        detail="Automatic pulling of the app repository is no longer supported.",
    )


@app.get("/api/versioning/app/history")
async def versioning_app_history() -> Dict[str, Any]:
    remote_url = APP_REPO_REMOTE_URL
    if not remote_url:
        raise HTTPException(status_code=500, detail="App remote URL for GitHub not configured")
    try:
        owner, repo = _parse_github_remote_url(remote_url)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    session = _make_github_session()
    try:
        commits = _fetch_github_commits(session, owner, repo)
        releases = _fetch_github_releases(session, owner, repo)
        tags = _fetch_github_tags_with_messages(session, owner, repo)
    except requests.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="GitHub API request failed")
    return {
        "owner": owner,
        "repo": repo,
        "remote_url": remote_url,
        "commits": commits,
        "releases": releases,
        "tags": tags,
    }


@app.get("/api/versioning/notes/history")
async def versioning_notes_history() -> Dict[str, Any]:
    remote_url = NOTES_REPO_REMOTE_URL
    if not remote_url:
        raise HTTPException(status_code=500, detail="Notes remote URL for GitHub not configured")
    try:
        owner, repo = _parse_github_remote_url(remote_url)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    session = _make_github_session()
    try:
        commits = _fetch_github_commits(session, owner, repo)
        releases = _fetch_github_releases(session, owner, repo)
        tags = _fetch_github_tags_with_messages(session, owner, repo)
    except requests.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="GitHub API request failed")
    return {
        "owner": owner,
        "repo": repo,
        "remote_url": remote_url,
        "commits": commits,
        "releases": releases,
        "tags": tags,
    }


def get_app_version_info() -> Dict[str, Any]:
    remote_url = APP_REPO_REMOTE_URL
    if not remote_url:
        return {
            "build_number": None,
            "latest_tag": None,
            "git_available": False,
        }

    try:
        owner, repo = _parse_github_remote_url(remote_url)
    except ValueError:
        return {
            "build_number": None,
            "latest_tag": None,
            "git_available": False,
        }

    session = _make_github_session()

    try:
        build_number = _fetch_github_commit_count(session, owner, repo)
        latest_tag = _fetch_latest_release_tag_name(session, owner, repo)
    except requests.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="GitHub API request failed")

    return {
        "build_number": build_number,
        "latest_tag": latest_tag,
        "git_available": True,
    }


@app.get("/api/versioning/app/info")
async def versioning_app_info() -> Dict[str, Any]:
    info = get_app_version_info()
    info["github_api_key_configured"] = bool(os.getenv("GITHUB_API_KEY"))
    return info


@app.get("/api/versioning/status")
async def versioning_status() -> Dict[str, Any]:
    ensure_notes_root()
    notes_root_str = str(NOTES_ROOT.resolve())
    github_configured = bool(os.getenv("GITHUB_API_KEY"))
    return {
        "notes_root": notes_root_str,
        "notes_remote_url": NOTES_REPO_REMOTE_URL,
        "app_root": str(APP_ROOT),
        "app_remote_url": APP_REPO_REMOTE_URL,
        "github_api_key_configured": github_configured,
    }
