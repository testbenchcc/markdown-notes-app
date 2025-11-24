# Architecture and Feature Inventory

## Purpose

This document summarizes the current implementation of the Markdown Notes App to support a forward-looking rework that:

- Uses Monaco Editor for editing.
- Uses markdown-it for markdown rendering.
- Uses Fancytree for the file/navigation pane.
- Uses GitPython for local git-based versioning of notes and app repositories.

The goal is to preserve the existing layout, button placements, search position, and overall UX while modernizing the internals.

## Current Implementation Status (v0.1.0 bootstrap)

- FastAPI application skeleton in `main.py` with `GET /health`.
- Notes root resolved from `NOTES_ROOT` env var or defaulting to `notes/` under the app root (directory is created on startup).
- `requirements.txt` defines the initial backend dependencies (FastAPI + Uvicorn); the rest of this document describes the target architecture for later roadmap stages.
- Minimal SPA shell under `static/` (`index.html`, `styles.css`, `app.js`) served from the FastAPI app at `/`.
- Frontend currently uses the legacy layout structure (nav pane, divider, content pane), calls `/health` to display basic status information, and loads note content into the viewer when a note is selected from the tree using `GET /api/notes/{note_path}`.
- Left-hand notes tree is implemented with **Fancytree**, backed by `/api/tree` (v0.4.0 work-increment).
- The UI now loads the **skin-lion** Fancytree stylesheet from `/static/skin-lion/` so the navigation pane matches the desired appearance without relying on vendor-hosted assets.
- Client navigation is now fully **GET-based** (v0.4.1): selecting notes or switching modes updates `?note=...&mode=...` in the URL, browser history works with back/forward, and direct links deep-link the UI state.
- Opening a note automatically expands, focuses, and selects its tree node so the navigation pane stays in sync with the URL-driven view (v0.4.1).
- Tree renames now use the Fancytree inline editor (v0.4.2) so double-click, Shift+click, clickActive, and F2 all trigger an in-place rename that validates input before calling the existing rename endpoints, with the previous prompt kept as a fallback, and the inline input adopts the dark theme styles for a cohesive appearance.
- Minimal settings backend in `main.py`:
  - `NotebookSettings` model (currently `tabLength` only) persisted to `.notebook-settings.json` under the notes root.
  - `/api/settings` (`GET`/`PUT`) to load and validate settings, wiring `tabLength` into server-side markdown rendering.
- Initial v0.2.0 backend/frontend work-in-progress:
  - Secure path helpers (`_validate_relative_path`, `_resolve_relative_path`, `_resolve_destination_path`).
  - Notes tree builder (`build_notes_tree`) and `GET /api/tree` endpoint.
  - Basic note CRUD endpoints: `GET/PUT /api/notes/{note_path}`, `POST /api/folders`, `POST /api/notes`.
  - Rename/delete endpoints for notes and folders: `POST /api/notes/rename`, `POST /api/folders/rename`, `DELETE /api/notes/{note_path}`, `DELETE /api/folders/{folder_path}`.
  - Image-serving endpoint `GET /files/{file_rel_path}` restricted to known image extensions.
  - Frontend wiring to render a read-only notes tree from `/api/tree` and load notes via `GET /api/notes/{note_path}`.
  - UI create flows: New Folder / New Note buttons call `POST /api/folders` and `POST /api/notes` respectively and refresh the tree.
  - UI rename/delete flows: tree selection + `F2` / `Delete` keys call the rename/delete endpoints and refresh the tree.
  - Image nodes in the tree open directly in the viewer via `/files/{file_rel_path}`.
  - Pytest-based tests in `tests/test_tree_and_paths.py`, `tests/test_notes_crud.py`, and `tests/test_rename_delete_and_files.py`.
- Recommended tooling decisions:
  - **Python**: Black (formatter), Ruff (linter), pytest (test runner).
  - **JavaScript**: Prettier (formatter), ESLint (linter); static assets are served directly by FastAPI without a bundler for now.

---

## High-level Architecture

- **Backend**
  - FastAPI application defined in `main.py`.
  - Notes stored as `.md` files under a configurable notes root (`NOTES_ROOT` env, default `notes/` under the app root).
  - Settings persisted in a JSON file `.notebook-settings.json` in the notes root, with schema defined by the `NotebookSettings` Pydantic model.
  - GitHub API used for app and notes repository history, build/tag info, and version metadata.

- **Frontend**
  - Single-page UI served from `static/index.html`.
  - Main behavior, including the Monaco-based markdown editor and markdown-it live preview, is implemented in `static/app.js`.
  - Settings modal markup is defined inline in `static/index.html` (see `.settings-overlay` / `.settings-modal`) and wired up via `static/app.js`.
  - Multiple CSS themes (`styles.css`, `styles-office.css`, `styles-high-contrast.css`, `styles-midnight.css`) selectable via settings.

- **Deployment/runtime**
  - Typical dev workflow: `uvicorn main:app --reload` in a virtual environment.
  - Docker and Docker Compose definitions for containerized usage.
  - Notes and application repositories can be distinct, with automation around committing/pushing notes.


---

## Backend Responsibilities (from `main.py`)

### Notes storage and safety

- **Notes root resolution**
  - `NOTES_ROOT` computed from env var or defaults to `APP_ROOT / "notes"`.
  - Helper `ensure_notes_root()` guarantees the directory exists.

- **Path validation and resolution**
  - `_validate_relative_path()` enforces that API paths:
    - Are non-empty, relative (no leading `/` or `\\`).
    - Do not escape the root via `..`.
  - `_resolve_relative_path()` and `_resolve_destination_path()` ensure that resolved paths stay under the notes root.

### Markdown rendering

- **Preprocessing**
  - `_preprocess_mermaid_fences()` converts \```mermaid fenced blocks into `<div class="mermaid">…</div>` to simplify client-side Mermaid integration.

- **Rendering**
  - `_render_markdown_html()` uses `markdown.markdown` with:
    - `extra` (common Markdown enhancements).
    - `codehilite` (syntax highlighting, inline CSS, no classes).
    - `pymdownx.tasklist` (task list checkboxes).
  - Honors `tabLength` from settings with robust fallback behavior.

### Settings

- **Model**
  - `NotebookSettings` tracks editor, image, theme, auto-save, and versioning-related options, including:
    - `editorSpellcheck`, `tabLength`, `autoSaveIntervalSeconds`.
    - `theme`, `exportTheme`, `indexPageTitle`.
    - Image display & storage options and size limits (`imageStorageMode`, `imageStorageSubfolder`, `localImageSubfolderName`, `imageMaxWidthPx`, `imageMaxHeightPx`, `imageMaxPasteBytes`).
    - Date/time format strings for shortcuts.
    - Auto-commit/pull notes repo and pull interval.

- **Persistence APIs**
  - `GET /api/settings` returns merged defaults + on-disk settings.
  - `PUT /api/settings` validates and persists settings to `.notebook-settings.json`.

### Notes APIs

- **Tree**
  - `GET /api/tree` exposes the notes hierarchy produced by `build_notes_tree()`:
    - Folders: `{ type: "folder", name, path, children: [...] }`.
    - Files: `{ type: "note" | "image", name, path }`.
    - Hides dotfiles and includes only `.md` files and whitelisted image types.

- **Read single note**
  - `GET /api/notes/{note_path}`:
    - Validates path.
    - Reads raw markdown.
    - Renders HTML using `_render_markdown_html()` and settings-based `tabLength`.
    - Returns `{ path, name, content, html }`.

- **Save single note**
  - `PUT /api/notes/{note_path}` with body `{ content }`:
    - Creates parent folders as needed.
    - Overwrites or creates the `.md` file.

- **Create folder**
  - `POST /api/folders` with `{ path }` (relative folder path):
    - Creates nested directories.
    - Ensures `.gitkeep` files for empty folders.

- **Create note**
  - `POST /api/notes` with `{ path, content? }`:
    - Appends `.md` if missing.
    - Validates and ensures the note does not already exist.
    - Writes optional initial content.

- **Serve note-related files (images)**
  - `GET /files/{file_rel_path}` serves images under the notes root:
    - Restricts to configured image extensions.
    - Returns correct `Content-Type`.

- **Paste-upload images**
  - `POST /api/images/paste` with multipart `note_path` + `file`:
    - Validates file type.
    - Enforces max size based on settings.
    - Stores the file under a path derived from `imageStorageMode` (`flat`, `matched`, or `local`) and related image storage settings.
    - Returns markdown snippet like `![image](/files/relative/path)` to be inserted into notes.

### Search

- **Text search across notes**
  - `GET /api/search?q=...`:
    - Walks all `.md` files under the notes root, excluding dot paths.
    - Returns matching lines (up to a fixed number per file) with line numbers.
     - The nav-pane search box calls this endpoint; clicking a result opens the note, syncs the tree selection, and highlights the corresponding line in the Monaco editor so the match is easy to spot (v0.5.0).

### Export / import

- **Export single note as HTML**
  - `GET /api/export-note/{note_path}` with optional `theme`:
    - Renders markdown to HTML using the same pipeline as the main viewer.
    - Embeds CSS from base + theme variant.
    - Inlines `mermaid.min.js` and runs it on `.mermaid` blocks.
    - Responds with a download of `note-name.html`.

- **Export notebook archive**
  - `GET /api/export` (from earlier scans):
    - Builds a zip containing the notebook files and selected app files (per roadmap: notes, static, app files, Docker files, etc.).

- **Import notebook archive**
  - `POST /api/import` with zip `file` and optional `force`:
    - Validates paths inside the archive.
    - Compares imported vs current timestamps (using metadata + git commit timestamps where available).
    - Optionally blocks overwriting newer local notes unless `force=true`.

### Versioning and GitHub integration

- Uses a GitHub fine-grained token (`GITHUB_API_KEY`) and per-repo remote URLs:
  - `APP_REPO_REMOTE_URL` for the app repo.
  - `NOTES_REPO_REMOTE_URL` for the notes repo.

- **Endpoints** include:
  - `POST /api/versioning/notes/commit-and-push` and `/api/versioning/notes/pull` for notes sync.
  - `POST /api/versioning/notes/gitignore/add` and `/remove` for adjusting a `.gitignore` under the notes root.
  - `GET /api/versioning/app/history` and `/api/versioning/notes/history` to view commits, releases, and tags via GitHub APIs.
  - `GET /api/versioning/app/info` and `/api/versioning/status` for summarized version/build and configuration status.

- **Planned rework (GitPython-based versioning)**
  - In the rework, GitPython will be used to manage local git repositories for the notes and app, handling commits, branches, tags, history, and push/pull to configured remotes.
  - Direct use of the GitHub REST API will be minimized and limited to optional metadata (for example, release notes), with GitPython providing the primary versioning functionality.

---

## Frontend Layout and Interaction Model

### Layout (from `static/index.html`)

- **Left nav pane**
  - Header: title (`#nav-title`) and icon buttons for new folder and new note.
  - Search input (`#search-input`) and inline search results (`#search-results`).
  - Tree container (`#tree`) for the notes/files hierarchy.
  - Footer: build/tag display with tag icon and a Settings icon button.

- **Divider**
  - Draggable splitter between nav pane and content pane.

- **Content pane**
  - Header: note name and path on the left, action buttons on the right:
    - Mode toggle (view/edit) using an edit icon.
    - Export note button.
  - Body:
    - Markdown viewer (`#viewer`) on the left.
    - Editor wrapper (`#editor-wrapper`) containing a line-number gutter and a `<div id="editor">` that hosts the Monaco editor on the right.

- **Global**
  - Error banner at the top of the app for user-facing error messages.
  - Hidden file input for notebook import.
  - `mermaid.min.js`, `markdown-it.min.js`, the Monaco AMD loader, and `app.js` loaded at the bottom of the body.

### Editor behavior (from `app.js` and `editor-highlighting.js`)

- **Base editor**
  - Uses a `<textarea>` for text input and selection.
  - `editor-highlighting.js` replaces the editor in the DOM with a wrapper that overlays a read-only, HTML-rendered view of the markdown behind the textarea.

- **Visual highlighting**
  - Inline overlay handles:
    - Headings with level-specific classes.
    - Bullets and task list items (`- [ ]` / `- [x]`).
    - Inline code (backticks) and fenced code blocks (```lang). 
    - Basic code tokenization (strings, numbers, keywords, comments) inside fenced blocks.
    - Markdown links and image links, highlighted as tokens.
  - Scroll and font/line-height are synchronized between textarea and overlay.

- **Line numbers**
  - A separate column renders line numbers aligned with the textarea content.
  - Scroll sync keeps numbers aligned as the user scrolls.

- **Mode switching and scroll sync**
  - The app tracks `mode = "view" | "edit"` and shows/hides viewer/editor accordingly.
  - Scroll position (as percentage) is synchronized between viewer and editor when switching modes and while scrolling in edit mode.
  - When Monaco loads lazily, the editor initializes from the currently loaded note so entering edit mode never shows a blank document.

- **Keyboard shortcuts** (per roadmap + `settings-modal.html`)
  - Editing shortcuts for bold/italics/links/code, lists, headings.
  - Save and toggle view/edit via keyboard.
  - Insert current date/time based on configurable patterns.
  - Indent/unindent and duplicate lines.
  - Shortcut behavior is modified when the cursor is inside inline code or fenced code blocks: only save, indenting, and duplication remain active.

### Tree and navigation (from `app.js`)

- Tree is currently rendered manually from the `/api/tree` JSON:
  - Each node becomes DOM elements with classes like `tree-item folder` or `tree-item note` and `data-path` attributes.
  - Expanded folders are tracked via a `Set` of paths and restored on reload.
  - Context menu overlay supports actions like new folder/note, rename, delete, expand/collapse, and gitignore management (per roadmap).

- Search integration:
  - Search box issues `GET /api/search?q=...`.
  - Results are displayed in `#search-results` with navigation into notes and line previews.

### Images and paste behavior

- When pasting into the editor:
  - Clipboard is scanned for image items.
  - If no note is selected, paste is rejected with a user-facing error.
  - For each image:
    - Enforced against `imageMaxPasteBytes` from settings; oversized uploads are rejected with a clear error message.
    - Uploaded via `/api/images/paste`.
    - Resulting markdown snippet from the server is inserted at the cursor.
    - Upload progress is displayed in an editor-panel banner using a hash-based progress bar that appears when the upload starts, updates during transfer, and briefly shows the result before disappearing.
  - Viewer respects image display options from settings (fit-width vs max-size, max width/height, alignment).

### Settings UI and persistence

- Settings modal categories:
  - **General**: spellcheck, title, tab width, date/time formats, auto-save interval, export/import buttons.
  - **File handling**: image display mode, max dimensions, default alignment, storage folder, image size limits, cleanup.
  - **Versioning**: auto-commit/pull, pull interval, notes root/remote URL, GitHub API key status, git history popup.
  - **Appearance**: theme selection and export theme selection.
  - **Keyboard Shortcuts**: documentation of all editor shortcuts and their behavior.

- State flow:
  - Settings are loaded from `/api/settings` with local defaults, then cached in `localStorage`.
  - Changes in the modal update a draft copy; categories are marked dirty when their settings differ from the last saved state.
  - Saving posts changes back to `/api/settings`, updates on-disk JSON, and re-applies theme/title/image settings live.

---

## Feature Inventory (based on `roadmap.md` and code)

The roadmap and implementation indicate the following major feature areas that must be preserved in a Monaco + markdown-it + Fancytree rework:

- **Core notebook**
  - File-based notes tree under a configurable root.
  - Create, rename, delete folders and notes.
  - Collapsible left-hand tree with keyboard navigation and context menus.
  - Right-hand markdown viewer and editor with synchronized scroll.
  - Search across notes.

- **Markdown rendering & editor UX**
  - Task list checkboxes, bullets, and indentation that render correctly.
  - Tables whose width is content-driven (not full pane width).
  - Mermaid diagrams rendered from ```mermaid blocks.
  - Syntax highlighting in both viewer and editor for fenced code blocks.
  - Line numbers in the editor.
  - Rich keyboard shortcuts for formatting and structural editing.

- **Images and assets**
  - Pasting images directly into the editor with automatic file naming and storage.
  - Only supporting common image formats; rejecting unsupported ones.
  - Ability to view images directly in the right pane when selected from the tree.
  - Configurable image storage subfolder and paste size limits.

- **Themes and appearance**
  - Multiple visual themes for the app.
  - Separate export theme selection for HTML exports.

- **Versioning and automation**
  - Git-backed notes repository with optional auto-commit and auto-pull.
  - GitHub API-based history views and app build/tag display in the UI footer.
  - Ability to manage notes `.gitignore` entries from the tree context menu.

- **Export/import**
  - Full notebook export/import as a zip, with conflict detection based on timestamps.
  - Single-note HTML export that matches app theme choices and supports Mermaid.

---

## Notes Relevant for the Monaco + markdown-it + Fancytree Rework

- **Editor (Monaco)**
  - Needs to replicate current behavior: line numbers, scroll sync with viewer, image paste insertion, keyboard shortcuts, and code-block-aware shortcut suppression.
  - Will become the primary source of truth for text; the current textarea + overlay can be replaced.

- **Markdown rendering (markdown-it)**
  - The current server-side renderer implements features we must reproduce client-side with markdown-it plugins/rules:
    - Task lists, tables, code fences, and inline code.
    - Mermaid support via fenced blocks and `.mermaid` containers.
  - We may keep Python-based rendering for export endpoints while using markdown-it for interactive preview.

- **Tree (Fancytree)**
  - Current tree JSON shape from `/api/tree` can be mapped to Fancytree node structures.
  - We must preserve:
    - Icons for open/closed folders, notes, and images.
    - Expand/collapse all actions and keyboard navigation.
    - Context menu commands including gitignore integration.

This report is an inventory and baseline. Follow-up reports in `rework-report/` will define the v2 design for Monaco, markdown-it, and Fancytree, and describe a migration plan from the current implementation.

---

## Roadmap Overview

The high-level implementation roadmap for the rework is tracked in [`roadmap.md`](./roadmap.md). It defines small, versioned increments from **v0.1.0** through **v1.0.0**:

- **v0.1.0 – Project Bootstrap**
  - Confirm FastAPI app structure, configuration, and health checks.
  - Ensure basic frontend shell and tooling are in place.

- **v0.2.0 – Core Notes CRUD and Tree Stability**
  - Harden notes/folder CRUD, tree APIs, and related tests.

- **v0.3.0 – Markdown Editing & Live Preview**
  - Introduce Monaco Editor and markdown-it while preserving existing UX.

- **v0.4.0 – Tree and Navigation Rework**
  - Move to Fancytree and keep current navigation behaviors.

- **v0.5.0 – Search & Filters Enhancements**
  - Improve search performance, filters, and integration with the tree and viewer.

- **v0.6.0 – Images & Paste Workflow Hardening**
  - Solidify paste-upload flows, limits, and image display behavior.

- **v0.7.0 – Settings UX and Persistence Refinement**
  - Refine settings model, persistence, and UI interactions.

- **v0.8.0 – GitPython-based Versioning**
  - Adopt GitPython for local notes/app repos and align the versioning UI.

- **v0.9.0 – UX Polish, Shortcuts, and Theming**
  - Polish keyboard shortcuts, theming, empty states, and visual details.

- **v1.0.0 – Stable Release**
  - Finalize UX, testing, and deployment configuration and tag `v1.0.0`.

Use `roadmap.md` as the source of truth for the detailed checklists for each version.
