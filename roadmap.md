 # Roadmap

 This roadmap describes how the Markdown Notes App evolves from initial restructuring work to a stable **v1.0.0** release.

 The focus is on:

 - Small, related increments.
 - Preserving the existing UX while modernizing internals (Monaco, markdown-it, Fancytree, GitPython).

 ---

 ## v0.1.0 – Project Bootstrap

 - **Backend (FastAPI)**
  - [ ] Initialize FastAPI project structure (app package, entrypoint, config management).
  - [ ] Ensure notes root and settings paths are clearly defined and configurable.
  - [ ] Add basic health route (`GET /health`).

 - **Frontend (JS)**
  - [ ] Confirm or scaffold a minimal SPA shell that can host the existing layout.
  - [ ] Wire up a simple build/dev workflow (e.g., existing static assets or a bundler).

 - **Tooling**
  - [ ] Confirm Python tooling (formatter, linter, test runner).
  - [ ] Confirm JS tooling (formatter, linter, bundler or dev server).

 ---

 ## v0.2.0 – Core Notes CRUD and Tree Stability

 - **Backend**
  - [ ] Reconfirm and stabilize the existing notes file tree APIs (`/api/tree`, `/api/notes`, `/api/folders`).
  - [ ] Ensure path validation and safety helpers are fully covered by tests.
  - [ ] Harden image-serving endpoints for note-related assets.

 - **Frontend**
  - [ ] Ensure the left-hand tree correctly reflects the backend model (folders, notes, images).
  - [ ] Verify creation/rename/delete flows for notes and folders work end-to-end.
  - [ ] Ensure image nodes open correctly in the viewer.

 - **Quality**
  - [ ] Add tests around notes/folder creation and deletion to avoid regressions.

 ---

 ## v0.3.0 – Markdown Editing & Live Preview (Monaco + markdown-it)

 - **Backend**
  - [ ] Keep server-side markdown rendering for exports and non-interactive use.
  - [ ] Validate any new options needed for markdown rendering in settings.

 - **Frontend**
  - [ ] Replace the textarea + overlay editor with **Monaco Editor** while preserving:
    - [ ] Line numbers.
    - [ ] Scroll sync with viewer.
    - [ ] Keyboard shortcuts for formatting.
  - [ ] Integrate **markdown-it** for client-side preview rendering, including:
    - [ ] Tables, task lists, fenced code blocks, inline code.
    - [ ] Mermaid code fences rendered into `.mermaid` blocks.
  - [ ] Ensure server and client markdown outputs stay visually consistent.

 ---

 ## v0.4.0 – Tree and Navigation Rework (Fancytree)

 - **Frontend**
  - [ ] Replace ad-hoc tree rendering with **Fancytree**.
  - [ ] Map `/api/tree` JSON to Fancytree node structures.
  - [ ] Preserve UX behaviors:
    - [ ] Icons for folders, notes, and images.
    - [ ] Expand/collapse state remembered across reloads.
    - [ ] Keyboard navigation (up/down, expand/collapse).
    - [ ] Context menu actions (new folder/note, rename, delete, gitignore management).

 - **Backend**
  - [ ] Keep `/api/tree` response stable enough for both old and new trees during transition if needed.

 ---

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
  - [ ] Integrate **GitPython** for local notes and app repositories.
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

