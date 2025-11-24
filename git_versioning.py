from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import socket
from pathlib import Path
from typing import Any, Dict, Optional

from git import GitCommandError, InvalidGitRepositoryError, NoSuchPathError, Repo


CONFLICT_BRANCH_PREFIX = "conflict"


@dataclass
class CommitResult:
    committed: bool
    hexsha: Optional[str] = None
    message: Optional[str] = None
    summary: Optional[str] = None


def _ensure_repo(notes_root: Path, remote_url: Optional[str] = None) -> Repo:
    """Open or initialize a Git repository at the given notes root.

    If ``remote_url`` is provided, ensure an ``origin`` remote exists and
    points to that URL.
    """

    root = Path(notes_root).resolve()
    root.mkdir(parents=True, exist_ok=True)

    try:
        repo = Repo(root)
    except (InvalidGitRepositoryError, NoSuchPathError):
        repo = Repo.init(root)

    if remote_url:
        origin = next((r for r in repo.remotes if r.name == "origin"), None)
        if origin is None:
            repo.create_remote("origin", remote_url)
        elif origin.url != remote_url:
            origin.set_url(remote_url)

    return repo


def _ensure_user_identity(repo: Repo) -> None:
    """Ensure the repository has a local user.name and user.email.

    This avoids commit failures in environments where Git is not globally
    configured. Existing values are preserved if already set.
    """

    try:
        reader = repo.config_reader()
        try:
            reader.get_value("user", "name")
            has_name = True
        except Exception:
            has_name = False

        try:
            reader.get_value("user", "email")
            has_email = True
        except Exception:
            has_email = False
    except Exception:
        has_name = False
        has_email = False

    if has_name and has_email:
        return

    writer = None
    try:
        writer = repo.config_writer()
        if not has_name:
            writer.set_value("user", "name", "Markdown Notes App")
        if not has_email:
            writer.set_value("user", "email", "markdown-notes-app@example.local")
    finally:
        if writer is not None:
            writer.release()


def _get_origin(repo: Repo):
    return next((r for r in repo.remotes if r.name == "origin"), None)


def _commit_notes(
    *,
    notes_root: Path,
    remote_url: Optional[str] = None,
    commit_message: Optional[str] = None,
) -> tuple[Repo, CommitResult]:
    """Stage all changes under ``notes_root`` and create a commit if needed."""

    repo = _ensure_repo(notes_root, remote_url)

    _ensure_user_identity(repo)

    # Stage all tracked and untracked changes.
    try:
        repo.git.add(all=True)
    except GitCommandError:
        # If "git add" fails for some reason, continue and rely on is_dirty.
        pass

    dirty = repo.is_dirty(index=True, working_tree=True, untracked_files=True)

    if dirty:
        message = commit_message or f"Auto-commit notes at {datetime.utcnow().isoformat()}Z"
        commit_obj = repo.index.commit(message)
        commit_info = CommitResult(
            committed=True,
            hexsha=commit_obj.hexsha,
            message=str(commit_obj.message).strip() or None,
            summary=getattr(commit_obj, "summary", None),
        )
    else:
        commit_info = CommitResult(
            committed=False,
            summary="No changes to commit",
        )

    return repo, commit_info


def _push_notes(repo: Repo) -> tuple[bool, Dict[str, Any]]:
    """Push the active branch to the ``origin`` remote if configured."""

    origin = _get_origin(repo)
    push_status: Dict[str, Any] = {
        "status": "skipped",
        "detail": "No 'origin' remote configured.",
    }
    pushed = False

    if origin is not None:
        try:
            try:
                branch_name = repo.active_branch.name
            except TypeError:
                branch_name = None

            if not branch_name:
                push_status = {
                    "status": "skipped",
                    "detail": "Repository is in a detached HEAD state; cannot determine branch to push.",
                }
            else:
                origin.push(branch_name)
                pushed = True
                push_status = {
                    "status": "ok",
                    "remote": origin.name,
                    "branch": branch_name,
                }
        except GitCommandError as exc:
            push_status = {
                "status": "error",
                "detail": str(exc),
            }

    return pushed, push_status


def commit_notes_only(
    *,
    notes_root: Path,
    remote_url: Optional[str] = None,
    commit_message: Optional[str] = None,
) -> Dict[str, Any]:
    """Stage all changes under ``notes_root`` and commit if needed (no push)."""

    repo, commit_info = _commit_notes(
        notes_root=notes_root,
        remote_url=remote_url,
        commit_message=commit_message,
    )

    # repo is currently unused but kept for symmetry with _commit_notes.
    _ = repo

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

    repo = _ensure_repo(notes_root, remote_url)
    pushed, push_status = _push_notes(repo)

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

    repo, commit_info = _commit_notes(
        notes_root=notes_root,
        remote_url=remote_url,
        commit_message=commit_message,
    )

    pushed, push_status = _push_notes(repo)

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

    repo = _ensure_repo(notes_root, remote_url)

    origin = _get_origin(repo)
    if origin is None:
        return {
            "status": "skipped",
            "detail": "No 'origin' remote configured.",
        }

    try:
        branch_ref = repo.active_branch
        branch_name = branch_ref.name
    except TypeError:
        return {
            "status": "error",
            "detail": "Repository is in a detached HEAD state; cannot pull.",
        }

    remote_branch_ref_name = f"{origin.name}/{branch_name}"

    # Record state before pull.
    local_before = branch_ref.commit.hexsha

    try:
        origin.fetch()
    except GitCommandError:
        # Non-fatal for our purposes; pull will surface any real problems.
        pass

    try:
        remote_before = repo.refs[remote_branch_ref_name].commit.hexsha
    except Exception:
        remote_before = None

    try:
        repo.git.pull("--rebase", origin.name, branch_name)
        local_after = branch_ref.commit.hexsha
        return {
            "status": "ok",
            "branch": branch_name,
            "localBefore": local_before,
            "localAfter": local_after,
            "remoteBefore": remote_before,
        }
    except GitCommandError as exc:
        # Attempt to abort any in-progress rebase.
        try:
            repo.git.rebase("--abort")
        except GitCommandError:
            pass

        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        host = socket.gethostname().split(".")[0]
        safe_host = "".join(ch for ch in host if ch.isalnum() or ch in ("-", "_")) or "host"
        conflict_branch_name = f"{CONFLICT_BRANCH_PREFIX}-{timestamp}-{safe_host}"

        conflict_created = False
        reset_status: Optional[str] = None

        try:
            # Create a branch that points to the pre-pull local commit.
            repo.create_head(conflict_branch_name, local_before)
            conflict_created = True
        except GitCommandError:
            conflict_created = False

        if remote_before:
            try:
                # Force the main branch back to the remote tip.
                repo.git.branch("-f", branch_name, remote_branch_ref_name)
                reset_status = "reset-to-remote"
            except GitCommandError:
                reset_status = "reset-failed"

        return {
            "status": "conflict",
            "branch": branch_name,
            "localBefore": local_before,
            "remoteBefore": remote_before,
            "conflictBranch": conflict_branch_name if conflict_created else None,
            "resetStatus": reset_status,
            "error": str(exc),
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
