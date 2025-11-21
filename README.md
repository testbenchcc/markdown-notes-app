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
- Simple text search across markdown notes
- Improved markdown rendering: fenced code blocks with syntax highlighting and tables with clear outlines
- No authentication or user accounts
- "New Note" dialog automatically appends `.md` if missing so new notes always appear in the tree

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
- The app treats the folder where `main.py` lives as the notebook root and uses a configurable `NOTES_ROOT` path defined near the top of `main.py`.
- You can also override the notes root by setting a `NOTES_ROOT` environment variable. If it is a relative path, it is resolved against the application root (the folder containing `main.py`).

To move or copy a notebook, you can either copy or clone the entire repository folder (including `notes/`), or use the in-app Export feature to download a zip archive and Import it into another instance.

## Export / import

- The UI includes `Export` and `Import` buttons in the top header bar (right side).
- **Export** downloads a zip file that contains:
  - The notes folder (always under a top-level `notes/` entry in the archive, regardless of where `NOTES_ROOT` lives on disk).
  - Core project files: `.git` (if present), `static/`, `docker-compose.yml`, `Dockerfile`, `main.py`, `requirements.txt`.
- **Import** accepts a previously exported zip and restores **only** the notes folder into the current `NOTES_ROOT`.
  - Notes are created or overwritten based on their relative paths.
  - If a note already exists and the imported version is **older** (based on the last git commit timestamp, with a filesystem modification time fallback), the app prompts you before overwriting newer notes.
  - If you decline, the import is cancelled and no files are overwritten.
  
- The editor header also includes an `Export` button next to `Save` that downloads the currently selected note as a standalone `.html` document.

## API overview

The backend exposes endpoints for:

- Listing the notes tree (`/api/tree`)
- Getting a single note (`GET /api/notes/{path}`)
- Saving a note (`PUT /api/notes/{path}`)
- Creating folders and notes (`POST /api/folders`, `POST /api/notes`)

See `main.py` for details.

## Roadmap

See `roadmap.md` for a Markdown task-list of enhancements (search, dark mode, export/import, etc.).
