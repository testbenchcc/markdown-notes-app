# Markdown Notes App

A self-contained FastAPI markdown notes application. Clone the repo, run the app, and edit `.md` files that live alongside the code.

## Features (v1)

- Simple FastAPI backend (no database, file-system only)
- Notes stored as plain `.md` files under the `notes/` folder
- Folders are treated as categories
- Web UI with:
  - Left pane: collapsible folder/note tree
  - Right pane: markdown note viewer/editor
  - View/Edit toggle and Save button
  - Draggable vertical splitter between panes
  - Inline error banner for failed API operations
  - Right-click context menu on tree items for quick actions (open note, copy path, create/rename/delete notes and folders)
  - Keyboard navigation in the notes tree (arrow keys, Home/End, Enter/Space)
  - Remembers the last opened note per browser (localStorage)
  - Theme support with a Gruvbox-inspired dark default (based on Obsidian Gruvbox), plus Office and High Contrast themes
- Simple text search across markdown notes
- Settings modal (via the file tree footer Settings button with a gear icon) with per-browser preferences, including options to enable spellcheck in the editor, select the UI theme, choose a default theme for exported HTML notes, and access notebook export/import controls
 - Notebook-level settings are stored in a JSON file under the notes root so they travel with exported/imported notebooks.
 - Dot-prefixed files and folders are automatically hidden from the notes tree and search results to keep the notebook view clean.
- Configurable index page title and file tree footer status showing the current app build number and git tag (when available)
- Improved markdown rendering: fenced code blocks with syntax highlighting and tables with clear outlines
- No authentication or user accounts
- "New Note" dialog automatically appends `.md` if missing so new notes always appear in the tree
- Optional auto-commit and push of notes to a dedicated Git repository under `notes/` (when enabled in Settings)
 - Optional periodic auto-pull of notes from the dedicated notes repository, using a configurable interval (when enabled in Settings)

## Requirements

- Python 3.11+
- `pip`
- (Optional) Docker and Docker Compose

## Installation (non-Docker)

```bash
# from the repo root
python -m venv .venv
# activate the venv (examples)
# Windows (PowerShell): .venv\Scripts\Activate.ps1
# Windows (cmd): .venv\Scripts\activate.bat
# macOS / Linux: source .venv/bin/activate

pip install -r requirements.txt
```

## Running the app (non-Docker)

From the project root:

```bash
uvicorn main:app --reload
```

Then open:

- http://localhost:8000

## Running with Docker Compose

From the project root:

```bash
docker compose up --build
# or: docker-compose up --build
```

Then open:

- http://localhost:8000

The container uses a bind mount of the project directory so that notes and code on the host are visible inside the container.

## Notes folder

- By default, all notes live under the `notes/` folder in this repo.
- Subfolders represent categories.
- Each `.md` file is a note.
- The `notes/` folder can also be initialized as a separate Git repository (for example `https://github.com/testbenchcc/markdown-notes.git`), which is git-ignored by the main app repo and used for versioning and sync.
- The app treats the folder where `main.py` lives as the notebook root and uses a configurable `NOTES_ROOT` path defined near the top of `main.py`.
- You can also override the notes root by setting a `NOTES_ROOT` environment variable. If it is a relative path, it is resolved against the application root (the folder containing `main.py`).

To move or copy a notebook, you can either copy or clone the entire repository folder (including `notes/`), or use the in-app Export feature to download a zip archive and Import it into another instance.

## Export / import

- The Settings modal (General category) includes `Export Notebook` and `Import Notebook` buttons.
- **Export** downloads a zip file that contains:
  - The notes folder (always under a top-level `notes/` entry in the archive, regardless of where `NOTES_ROOT` lives on disk).
  - Core project files: `.git` (if present), `static/`, `docker-compose.yml`, `Dockerfile`, `main.py`, `requirements.txt`.
- **Import** accepts a previously exported zip and restores **only** the notes folder into the current `NOTES_ROOT`.
  - Notes are created or overwritten based on their relative paths.
  - If a note already exists and the imported version is **older** (based on the last git commit timestamp, with a filesystem modification time fallback), the app prompts you before overwriting newer notes.
  - If you decline, the import is cancelled and no files are overwritten.
  
- The editor header also includes an `Export` button next to `Save` that downloads the currently selected note as a standalone `.html` document, using the theme selected in the Appearance settings (by default matching the app theme).

## API overview

The backend exposes endpoints for:

- Listing the notes tree (`/api/tree`)
- Getting a single note (`GET /api/notes/{path}`)
- Saving a note (`PUT /api/notes/{path}`)
- Creating folders and notes (`POST /api/folders`, `POST /api/notes`)

See `main.py` for details.

## Roadmap

See `roadmap.md` for a Markdown task-list of enhancements (search, dark mode, export/import, etc.).

## Needed APIs

- If auto push is configured in the settings a Github fine-grained personal access token with Content read/write is needed.
 - Environment variables are loaded from a local `.env` file (using `python-dotenv`). Define values such as `GITHUB_API_KEY`, `NOTES_REPO_REMOTE_URL`, and `APP_REPO_REMOTE_URL` there as needed.

