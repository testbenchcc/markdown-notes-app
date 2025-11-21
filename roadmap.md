# Markdown Notes App Roadmap

## v1 – Core notebook (this repo)

- [x] FastAPI backend serving:
  - [x] Notes tree (`/api/tree`)
  - [x] Get note
  - [x] Save note
  - [x] Create folder
  - [x] Create note
- [x] File-system storage only under `notes/`.
- [x] Simple HTML/CSS/JS single-page UI:
  - [x] Collapsible left-hand tree view
  - [x] Right-hand markdown viewer/editor
  - [x] View/Edit toggle and Save button
  - [x] Resizable panes via draggable splitter
- [x] Dockerfile and docker-compose.yml for portable usage.

## v1.x – Quality of life

- [x] Improve error messages in the UI (failed loads/saves, invalid paths). (implemented)
- [x] Remember last selected note in `localStorage`. (implemented)
- [x] Optional environment variable to override the notes root folder. (implemented)
- [ ] Basic unit tests for filesystem operations. (ignore task for now)
- [x] Fix `New Note` creation so notes are saved with `.md` extension and immediately appear in the notes tree. (implemented)

## v2 – Search and UX

- [ ] Add simple text search across markdown files.
- [ ] Improve tree UX (keyboard navigation, better folder icons).
- [ ] Optional dark mode.
- [x] Add context menu for tree items. (implemented)

## v3 – Advanced features (optional)

- [ ] Configurable markdown renderer options (extensions, safe mode).
- [ ] Export/import utilities (zip up notebook, import from another folder).

This roadmap is intentionally simple and can be adjusted as the project evolves.
