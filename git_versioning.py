from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import os
import socket
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional


CONFLICT_BRANCH_PREFIX = "conflict"


@dataclass
class CommitResult:
    committed: bool
    hexsha: Optional[str] = None
    message: Optional[str] = None
    summary: Optional[str] = None


def _build_authenticated_url(base_url: str) -> str:
    """Return an HTTPS URL augmented with GITHUB_API_KEY credentials if available.

    The token is injected only in-memory for individual git commands and is not
    written back to git configuration. If the URL already contains credentials
    or no token is configured, the original URL is returned unchanged.
    """

    token = os.getenv("GITHUB_API_KEY") or ""
    if not token:
        return base_url

    if not base_url.startswith("https://"):
        return base_url

    prefix = "https://"
    rest = base_url[len(prefix) :]

    # If credentials are already present (for example, user included a token
    # directly in NOTES_REPO_REMOTE_URL), leave the URL as-is.
    host_part = rest.split("/", 1)[0]
    if "@" in host_part:
        return base_url

    # For GitHub PATs, recommended form is https://x-access-token:PAT@github.com/...
    return f"{prefix}x-access-token:{token}@{rest}"


def _sanitize_git_error(message: str) -> str:
    """Redact any occurrence of the GITHUB_API_KEY token from git error text."""

    token = os.getenv("GITHUB_API_KEY") or ""
    if token and token in message:
        message = message.replace(token, "****")
    return message


def _run_git(notes_root: Path, *args: str) -> tuple[bool, str, str, int]:
    """Run a git command in the given notes root and return (ok, stdout, stderr, code)."""

    proc = subprocess.run(
        ["git", *args],
        cwd=str(notes_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return proc.returncode == 0, proc.stdout, proc.stderr, proc.returncode


def _ensure_repo(notes_root: Path, remote_url: Optional[str] = None) -> None:
    """Open or initialize a Git repository at the given notes root.

    If ``remote_url`` is provided, ensure an ``origin`` remote exists and
    points to that URL.
    """

    root = Path(notes_root).resolve()
    root.mkdir(parents=True, exist_ok=True)

    git_dir = root / ".git"
    if not git_dir.is_dir():
        _run_git(root, "init")

    if remote_url:
        ok, current_url, _, _ = _run_git(root, "remote", "get-url", "origin")
        if not ok:
            _run_git(root, "remote", "add", "origin", remote_url)
        elif current_url.strip() != remote_url:
            _run_git(root, "remote", "set-url", "origin", remote_url)


def _ensure_user_identity(notes_root: Path) -> None:
    """Ensure the repository has a local user.name and user.email.

    This avoids commit failures in environments where Git is not globally
    configured. Existing values are preserved if already set.
    """

    root = Path(notes_root).resolve()

    ok_name, name_out, _, _ = _run_git(root, "config", "--get", "user.name")
    has_name = ok_name and bool(name_out.strip())

    ok_email, email_out, _, _ = _run_git(root, "config", "--get", "user.email")
    has_email = ok_email and bool(email_out.strip())

    if has_name and has_email:
        return

    if not has_name:
        _run_git(root, "config", "user.name", "Markdown Notes App")
    if not has_email:
        _run_git(root, "config", "user.email", "markdown-notes-app@example.local")


def _get_current_branch(notes_root: Path) -> tuple[Optional[str], Optional[str]]:
    """Return the current branch name or an error message if unavailable."""

    root = Path(notes_root).resolve()
    ok, out, err, _ = _run_git(root, "rev-parse", "--abbrev-ref", "HEAD")
    if not ok:
        return None, _sanitize_git_error(err or out)

    branch = out.strip()
    if not branch or branch == "HEAD":
        return None, "Repository is in a detached HEAD state; cannot determine branch."

    return branch, None


def _get_head_hexsha(notes_root: Path) -> Optional[str]:
    root = Path(notes_root).resolve()
    ok, out, _, _ = _run_git(root, "rev-parse", "HEAD")
    value = out.strip()
    return value if ok and value else None


def _commit_notes(
    *,
    notes_root: Path,
    remote_url: Optional[str] = None,
    commit_message: Optional[str] = None,
) -> CommitResult:
    """Stage all changes under ``notes_root`` and create a commit if needed."""

    root = Path(notes_root).resolve()
    _ensure_repo(root, remote_url)
    _ensure_user_identity(root)

    # Stage all tracked and untracked changes.
    _run_git(root, "add", "-A")

    ok_status, status_out, _, _ = _run_git(root, "status", "--porcelain")
    dirty = ok_status and bool(status_out.strip())

    if not dirty:
        return CommitResult(
            committed=False,
            summary="No changes to commit",
        )

    message = commit_message or f"Auto-commit notes at {datetime.utcnow().isoformat()}Z"
    ok_commit, _, commit_err, _ = _run_git(root, "commit", "-m", message)
    if not ok_commit:
        return CommitResult(
            committed=False,
            summary=_sanitize_git_error(commit_err) or "Commit failed",
        )

    hexsha = _get_head_hexsha(root)

    return CommitResult(
        committed=True,
        hexsha=hexsha,
        message=message,
        summary=None,
    )


def _push_notes(notes_root: Path) -> tuple[bool, Dict[str, Any]]:
    """Push the active branch to the ``origin`` remote if configured."""

    root = Path(notes_root).resolve()

    ok_remote, _, _, _ = _run_git(root, "remote", "get-url", "origin")
    if not ok_remote:
        return False, {
            "status": "skipped",
            "detail": "No 'origin' remote configured.",
        }

    branch_name, branch_error = _get_current_branch(root)
    if not branch_name:
        return False, {
            "status": "skipped",
            "detail": branch_error
            or "Repository is in a detached HEAD state; cannot determine branch to push.",
        }

    ok_push, _, push_err, _ = _run_git(root, "push", "origin", branch_name)
    if not ok_push:
        return False, {
            "status": "error",
            "detail": _sanitize_git_error(push_err),
        }

    return True, {
        "status": "ok",
        "remote": "origin",
        "branch": branch_name,
    }


def commit_notes_only(
    *,
    notes_root: Path,
    remote_url: Optional[str] = None,
    commit_message: Optional[str] = None,
) -> Dict[str, Any]:
    """Stage all changes under ``notes_root`` and commit if needed (no push)."""

    commit_info = _commit_notes(
        notes_root=notes_root,
        remote_url=remote_url,
        commit_message=commit_message,
    )

    return {
        "committed": bool(commit_info.committed),
        "commit": commit_info.__dict__,
    }


def push_notes(
    *,
    notes_root: Path,
    remote_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Push the active branch for the notes repo to its ``origin`` remote."""

    root = Path(notes_root).resolve()
    _ensure_repo(root, remote_url)
    pushed, push_status = _push_notes(root)

    return {
        "pushed": pushed,
        "push": push_status,
    }


def commit_and_push_notes(
    *,
    notes_root: Path,
    remote_url: Optional[str] = None,
    commit_message: Optional[str] = None,
) -> Dict[str, Any]:
    """Stage all changes under ``notes_root``, commit if needed, and push.

    Returns a JSON-serializable dict describing commit and push results.
    """

    commit_info = _commit_notes(
        notes_root=notes_root,
        remote_url=remote_url,
        commit_message=commit_message,
    )

    root = Path(notes_root).resolve()
    pushed, push_status = _push_notes(root)

    return {
        "committed": bool(commit_info.committed),
        "commit": commit_info.__dict__,
        "pushed": pushed,
        "push": push_status,
    }


def pull_notes_with_rebase(
    *,
    notes_root: Path,
    remote_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Run a conflict-aware ``git pull --rebase`` for the notes repo.

    On conflict or error, a conflict branch like ``conflict-<timestamp>-<host>``
    is created from the pre-pull state and the main branch is reset back to the
    remote tip when possible. Local changes are preserved on the conflict
    branch.
    """

    root = Path(notes_root).resolve()
    _ensure_repo(root, remote_url)

    ok_remote, _, _, _ = _run_git(root, "remote", "get-url", "origin")
    if not ok_remote:
        return {
            "status": "skipped",
            "detail": "No 'origin' remote configured.",
        }

    branch_name, branch_error = _get_current_branch(root)
    if not branch_name:
        return {
            "status": "error",
            "detail": branch_error or "Repository is in a detached HEAD state; cannot pull.",
        }

    remote_branch_ref_name = f"origin/{branch_name}"

    # Record state before pull.
    ok_local_before, local_before_out, _, _ = _run_git(root, "rev-parse", "HEAD")
    local_before = local_before_out.strip() if ok_local_before and local_before_out.strip() else None

    ok_remote_before, remote_before_out, _, _ = _run_git(root, "rev-parse", remote_branch_ref_name)
    remote_before = remote_before_out.strip() if ok_remote_before and remote_before_out.strip() else None

    # Fetch latest changes; errors here are non-fatal and will surface on pull.
    _run_git(root, "fetch", "origin")

    try:
        ok_pull, _, pull_err, _ = _run_git(root, "pull", "--rebase", "origin", branch_name)
        if not ok_pull:
            raise RuntimeError(pull_err or "git pull --rebase failed")

        ok_after, local_after_out, _, _ = _run_git(root, "rev-parse", "HEAD")
        local_after = local_after_out.strip() if ok_after and local_after_out.strip() else None
        return {
            "status": "ok",
            "branch": branch_name,
            "localBefore": local_before,
            "localAfter": local_after,
            "remoteBefore": remote_before,
        }
    except Exception as exc:  # pragma: no cover - defensive fallback
        # Attempt to abort any in-progress rebase.
        _run_git(root, "rebase", "--abort")

        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        host = socket.gethostname().split(".")[0]
        safe_host = "".join(ch for ch in host if ch.isalnum() or ch in ("-", "_")) or "host"
        conflict_branch_name = f"{CONFLICT_BRANCH_PREFIX}-{timestamp}-{safe_host}"

        conflict_created = False
        reset_status: Optional[str] = None

        if local_before:
            ok_conflict, _, _, _ = _run_git(root, "branch", conflict_branch_name, local_before)
            conflict_created = ok_conflict

        if remote_before:
            ok_reset, _, _, _ = _run_git(root, "branch", "-f", branch_name, remote_branch_ref_name)
            reset_status = "reset-to-remote" if ok_reset else "reset-failed"

        return {
            "status": "conflict",
            "branch": branch_name,
            "localBefore": local_before,
            "remoteBefore": remote_before,
            "conflictBranch": conflict_branch_name if conflict_created else None,
            "resetStatus": reset_status,
            "error": _sanitize_git_error(str(exc)),
        }


def _read_gitignore(path: Path) -> list[str]:
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf8")
    # Preserve non-empty lines; ignore trailing newlines.
    lines = [line.rstrip("\n") for line in text.splitlines()]
    return lines


def _write_gitignore(path: Path, lines: list[str]) -> None:
    # Normalize to "\n" line endings.
    content = "\n".join(lines) + ("\n" if lines else "")
    path.write_text(content, encoding="utf8")


def add_gitignore_pattern(notes_root: Path, pattern: str) -> Dict[str, Any]:
    """Add a single pattern line to ``.gitignore`` under the notes root."""

    cleaned = (pattern or "").strip()
    if not cleaned:
        raise ValueError("Pattern must not be empty")

    gitignore_path = Path(notes_root).resolve() / ".gitignore"
    lines = _read_gitignore(gitignore_path)

    if cleaned not in lines:
        lines.append(cleaned)
        _write_gitignore(gitignore_path, lines)
        added = True
    else:
        added = False

    return {
        "path": str(gitignore_path),
        "pattern": cleaned,
        "added": added,
        "lines": lines,
    }


def remove_gitignore_pattern(notes_root: Path, pattern: str) -> Dict[str, Any]:
    """Remove a single pattern line from ``.gitignore`` under the notes root."""

    cleaned = (pattern or "").strip()
    if not cleaned:
        raise ValueError("Pattern must not be empty")

    gitignore_path = Path(notes_root).resolve() / ".gitignore"
    lines = _read_gitignore(gitignore_path)

    before = len(lines)
    lines = [line for line in lines if line != cleaned]
    removed = len(lines) < before

    _write_gitignore(gitignore_path, lines)

    return {
        "path": str(gitignore_path),
        "pattern": cleaned,
        "removed": removed,
        "lines": lines,
    }
