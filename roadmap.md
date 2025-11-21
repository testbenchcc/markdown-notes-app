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

## v1.x – Search and UX

- [x] Add simple text search across markdown files. (implemented)
- [x] Improve tree UX (keyboard navigation, better folder icons). (implemented)
- [x] Add context menu for tree items. (implemented)

## v1.1.x – Advanced features (optional)

- [x] Improve markdown rendering. (Code rendering within ``` fences and table outlines) (implemented)
- [x] Export/import utility (export and import notebook as zip file). (implemented)
  - Include: ./.git, ./notes, ./static, docker-compose.yml, Dockerfile, main.py, requirements.txt
- [x] Export note to html document. (implemented)
- [x] Improve coloring for markdown using @.\example files\Obsidian gruvbox. (implemented)

## v1.1.4 - Settings modal

- [x] Add a modal for settings. Set its width to 80% of screen width. Much like Obsidian, have catigory selection on the left, and the catigories settings on the right. The save button should be for the entire modal, instead of page by page. Change the color of the category if something is changed. I would like this modal html to go into its own file to keep things organized and easy to edit. (implemented)

## v1.1.5 - Themes

- [x] Implement a theme/Appearance selection. Allow for index to switch between multiple style.css files. Keep the existing styles.css file, but create variations of it to swap in (or whatever the best practice is, just keep it simple). Utilize the settings modal. Reload when the selection is made so the user can preview the change, but do not make it permanent until settings are applied. (implemented)
- [x] Create a professional theme for office settings. I still want a bit of color, not just black and white. (implemented)
- [x] Create a high contrast theme. (implemented)

## v1.1.6 - Note export improvements

- [x] Add a default theme selection to the settings modal Appearance category for the exported theme default. (implemented)
- [x] Update note exporting to use the selected theme. (implemented)

## v1.1.7 - Version Revisoning

- [] Add setting for auto-commiting items in the notes folder, pushing, pulling, repository, github api key.
- [] Add setting for auto pulling on new version release. have a setting for how often it checks. 
- [] Automatically commit, push, and pull using using the configured settings. 


## v1.1.8 - Update sub-title 

- [] Add a setting for the page title which is currently hard coded to `NoteBooks`.
- [] Set the build number (number of commits) and tag (if it exists) for the top-bar-subtitle text. use github api key configured in settings.