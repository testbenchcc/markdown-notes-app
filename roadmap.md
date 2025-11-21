# Markdown Notes App Roadmap

## v1 – Core notebook (this repo)

- FastAPI backend serving:
  - Notes tree (`/api/tree`)
  - Get note
  - Save note
  - Create folder
  - Create note
- File-system storage only under `notes/`.
- Simple HTML/CSS/JS single-page UI:
  - Collapsible left-hand tree view
  - Right-hand markdown viewer/editor
  - View/Edit toggle and Save button
  - Resizable panes via draggable splitter
- Dockerfile and docker-compose.yml for portable usage.

## v1.x – Quality of life

- Improve error messages in the UI (failed loads/saves, invalid paths). (implemented)
- Remember last selected note in `localStorage`. (implemented)
- Optional environment variable to override the notes root folder. (implemented)
- Basic unit tests for filesystem operations.
- Fix `New Note` creation so notes are saved with `.md` extension and immediately appear in the notes tree.

## v2 – Search and UX

- Add simple text search across markdown files.
- Improve tree UX (keyboard navigation, better folder icons).
- Optional dark mode.
- Add context menu for tree items.

## v3 – Advanced features (optional)

- Configurable markdown renderer options (extensions, safe mode).
- Export/import utilities (zip up notebook, import from another folder).

This roadmap is intentionally simple and can be adjusted as the project evolves.
