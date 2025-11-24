 # Roadmap

 This roadmap describes how the Markdown Notes App evolves from initial restructuring work to a stable **v1.0.0*- release.

 The focus is on:

 - Small, related increments.

---

## v0.1.0 – Project Bootstrap

- **Backend (FastAPI)**
  - [x] Initialize FastAPI project structure (app package, entrypoint, config management).
  - [x] Ensure notes root and settings paths are clearly defined and configurable.
  - [x] Add basic health route (`GET /health`).

- **Frontend (JS)**
  - [x] Confirm or scaffold a minimal SPA shell that can host the existing layout.
  - [x] Wire up a simple build/dev workflow (FastAPI app + static assets served via `uvicorn main:app --reload`).

- **Tooling**
  - [x] Confirm Python tooling (formatter, linter, test runner: Black, Ruff, pytest).
  - [x] Confirm JS tooling (formatter, linter, dev workflow: Prettier, ESLint, static assets without a bundler for now).

 ---

 ## v0.2.0 – Core Notes CRUD and Tree Stability

 - **Backend**
  - [x] Reconfirm and stabilize the existing notes file tree and CRUD APIs (`/api/tree`, `GET/PUT /api/notes`, `POST /api/folders`, `POST /api/notes`).
  - [x] Ensure path validation and safety helpers are fully covered by tests (tree building + note/folder creation paths).
  - [x] Harden image-serving endpoints for note-related assets (e.g., `/files/...`, image-specific validation and safety checks).

 - **Frontend**
  - [x] Ensure the left-hand tree correctly reflects the backend model (folders, notes, images) using `/api/tree`.
  - [x] Verify creation flows for notes and folders work end-to-end (New Folder/New Note → CRUD APIs → tree refresh and viewer load).
  - [x] Add rename/delete flows for notes and folders (backend endpoints + UI wiring).
  - [x] Ensure image nodes open correctly in the viewer.

 - **Quality**
  - [x] Add tests around notes/folder creation to avoid regressions (`tests/test_tree_and_paths.py`, `tests/test_notes_crud.py`).
  - [x] Add tests around delete/rename behavior once implemented (`tests/test_rename_delete_and_files.py`).

---

## v0.3.0 – Markdown Editing & Live Preview (Monaco + markdown-it)

- **Backend**
  - [x] Keep server-side markdown rendering for exports and non-interactive use.
  - [x] Validate any new options needed for markdown rendering in settings.

- **Frontend**
  - [x] Replace the textarea + overlay editor with **Monaco Editor*- while preserving:
    - [x] Line numbers.
    - [x] Scroll sync with viewer.
    - [-] Keyboard shortcuts for formatting. (hold off on this item)
  - [x] Integrate **markdown-it*- for client-side preview rendering, including:
    - [x] Mermaid code fences rendered into `.mermaid` blocks.

---

## v0.4.0 – Tree and Navigation Rework (Fancytree)

- **Frontend**
  - [x] Replace ad-hoc tree rendering with **Fancytree**.
  - [x] Map `/api/tree` JSON to Fancytree node structures.
  - [x] Preserve UX behaviors:
    - [x] Icons for folders, notes, and images.
    - [x] Expand/collapse state remembered across reloads.
    - [x] Keyboard navigation (up/down, expand/collapse).
    - [-] Context menu actions (new folder/note, rename, delete; gitignore management deferred).

- **Backend**
  - [x] Keep `/api/tree` response stable enough for both old and new trees during transition if needed.

---

## v0.4.1 - Switch all navigation routes to GET

- [x] Update the interface so **all navigation inside the app actually uses GET URLs**, not just external links. When I click notes or use editor controls, the browser URL updates to reflect the current note and mode.
  - [www.site.com/?note=/markdown.md&mode=edit](http://www.site.com/?note=/markdown.md&mode=edit)
  - [www.site.com/?note=/markdown.md&mode=view](http://www.site.com/?note=/markdown.md&mode=view)
  - [www.site.com/?note=/markdown.md&mode=export](http://www.site.com/?note=/markdown.md&mode=export)
  - [www.site.com/?note=/markdown.md&mode=download](http://www.site.com/?note=/markdown.md&mode=download)
- [x] When a note is opened, ensure its tree item is expanded, visible, and selected.

## v0.5.0 – Search & Filters Enhancements

- **Backend**
  - [ ] Review and, if necessary, optimize `/api/search` for typical notebook sizes.
  - [ ] Ensure safe handling of search queries and limits on results.

 - **Frontend**
  - [ ] Integrate search results more tightly with the tree and content pane.
  - [ ] Provide filters (e.g., note vs image, path-based narrowing) as reasonable.
  - [ ] Optionally highlight search matches within notes.

 ---

 ## v0.6.0 – Images & Paste Workflow Hardening

 - **Backend**
  - [ ] Revisit `/api/images/paste` to ensure:
    - [ ] File type validation and size limits from settings.
    - [ ] Robust error responses for oversized or invalid images.
  - [ ] Confirm image storage structure (subfolder, naming scheme) is stable.

 - **Frontend**
  - [ ] Ensure pasted images integrate smoothly with Monaco editor:
    - [ ] Insert returned markdown snippets at cursor.
    - [ ] Provide clear error messages for rejected pastes.
  - [ ] Confirm viewer behavior for images (fit-width, max-size, alignment) matches settings.

 ---

 ## v0.7.0 – Settings UX and Persistence Refinement

 - **Backend**
  - [ ] Confirm `NotebookSettings` fields fully cover new editor/tree/versioning needs.
  - [ ] Add tests for settings load/merge/save behavior.

 - **Frontend**
  - [ ] Refine settings modal categories and visual feedback for unsaved changes.
  - [ ] Ensure live updates for theme, title, and key editor preferences.
  - [ ] Keep local caching behavior consistent and robust.

 ---

 ## v0.8.0 – GitPython-based Versioning

 - **Backend**
  - [ ] Integrate **GitPython*- for local notes and app repositories.
  - [ ] Implement operations:
    - [ ] Commit and push notes repo.
    - [ ] Pull notes repo safely, with conflict awareness.
    - [ ] Manage `.gitignore` entries under notes root.
  - [ ] Minimize direct GitHub REST usage, reserving it for optional metadata.

 - **Frontend**
  - [ ] Ensure versioning UI (history views, status, gitignore management) uses the new backend flows.
  - [ ] Provide clear error and success feedback for git operations.

 ---

 ## v0.9.0 – UX Polish, Shortcuts, and Theming

 - **Frontend**
  - [ ] Audit keyboard shortcuts and ensure they work correctly with Monaco.
  - [ ] Polish themes (base, office, high contrast, midnight) and ensure they work with new components.
  - [ ] Improve empty states, error banners, and loading indicators.
  - [ ] Ensure responsive behavior is acceptable for common window sizes.

 - **Backend**
  - [ ] Add or refine logging to support debugging production issues.

 ---

 ## v1.0.0 – Stable Release

 - **Definition of Done**
  - [ ] All major feature areas preserved: notes tree, markdown editing, images, search, themes, versioning, export/import.
  - [ ] Monaco + markdown-it + Fancytree + GitPython are the primary implementation stack.
  - [ ] Core workflows have automated test coverage (backend + critical frontend paths).

 - **Release tasks**
  - [ ] Final UX pass for layout, labels, and navigation.
  - [ ] Prepare deployment configuration (Docker, Compose, or equivalent).
  - [ ] Tag `v1.0.0` in git with release notes summarizing the roadmap.
  - [ ] Update `README.md` with final feature list and pointers to this roadmap.

