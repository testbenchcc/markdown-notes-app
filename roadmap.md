## 1.4.0 - Gitignore context menu

- [x] Expand all and Callapse all should also be in the content menu for files
- [x] Add context menu item for folders and files to add and remove it from the notes repository .gitignore. Only show these items if `Automatically commit and push notes after saving` is enabled.
- [x] Add a .gitkeep file to any new folders as a precaution

## v1.3.9 - Keyboard shortcuts

- [x] Add tipical keyboard shortcuts when we are using the editor.
  - ctrl+s - manually trigger a save. Do not show the default save dialog moast browsers show.
  - tab - insert a tab (use tab_length value). This currently being used for screen navigation by the system.
  - ctrl+; - insert the current date (format set on settings page)
  - ctrl+shift+; - insert the current time (format set on settings page)

## v1.3.8 - Allow viewing of images

- [x] Allow user to view images in file tree, and view then in the right pane when selected.

## v1.3.7 - Move env variable to settings modal

- [ ] Move NOTES_ROOT into the settings modal
- [x] Move tab_length value to settings modal

## v1.3.6 - Commit conditions

- [x] Our current save configuration leaves us suceptable to missing saves. Whatever the save button is doing now, I would like to do the same when we switch from the editor to the reader, when we change notes, when we delete something, when we rename something, when we save settings modal, and finally, when we create a new note. We should also auto save after a period (configurated in the settings modal) 
- [x] Remove the save button

## v1.3.5 - Expand tree context menu

- [x] Add an expand all in folder, expand all, and collapse all options. 

## v1.3.4 - Images in notes

- [x] Auto rename new files using datetime.
- [x] periodic cleanup. If the image is not referenced, get rid of it.
- [x] Support only support paste in.
- [x] Add a textual reference to the image, much like other markdown editors (`![image desc](./configured/path/to/image.png)`).
- [x] Validate image formats (png, gif, jpeg, svg, jpg, webp). Avoid accidental unsupported files.
- [x] Add a setting for max image size on paste, confirm with user to bypass when pasted if we exceed the max.
- [x] Add a setting for storage location. It must be within the notes folder.

## v1.3.3 - Syntax highlighting in the editor

- [x] Add color formatting to the editor. It should match the reader, only the text size will not change in the editor. Markdown bullets `- [ ]` and normall bullets `- ` should be colored. Code within ``` ``` should have syntax highlighting. 

## v1.3.2 - Reader and Editor alignment (skipped v1.3.1) ☉ ‿ ⚆

- [x] When viewing a note, we need to align the reader and the editors with each other. Make sure they both have thier own scrool containers and, when we switch between them, copy the scroll position as a percentage from one to the other.

## v1.3.0 - Small UI adjustment

- [x] Reformat `Build 37 | Tag v1.2.9` in the tree pane footer with `<tag icon> <tag>.<build>`. I have added a new image `static\icons\tag.png`
  - Related files: 
    - static\index.html
- [x] Change settings modal to always be 90vh, when content does not fit, use vertical scroll bars.

## v1.2.9 - New notes and file tree

- [x] Creating a new and deleting notes closes all items in the file tree. The file tree items should only close after the page loads. 
- [x] Update the file tree to use icons. Use (static\icons\folder-closed.png) for the closed folders and  (static\icons\folder-open.png) open folders. Use (static\icons\file-single.png) for the files. 
- [x] Make the files and folders different collors if possible. Subtle.

## v1.2.8 - Markdown formatting

- [x] Markdown checkboxes are not rendering (implemented)
- [x] Indentations are not rendering. Some indents are 2 spaces. (implemented)

## v1.2.7 - View git info

- [x] On the settings versioning category add buttons to view commit info (short hash, title, message), and release/tags (tag names, and descriptions). I think a popup would be best. That goes for both the application, and notes repositories. (implemented)

## v1.2.6 - Line numbers

- [x] Add line numbers to the note editor (implemented)

## v1.2.5 - Export improvements

- [x] Mermaid graphs are not rendered correctly when notes are exported. Example explort: `example files\mermaid.html` (implemented)

## v1.2.4 - Markdown formating improvements

- [x] Markdown tables width should not expand to fit the window or panes width. Fit to the contents of the table. (implemented)
- [x] When code is marked as mermaid (a fenced code block starting with ```mermaid), render the chart/graph in the notes viewer. (implemented)

## v1.2.3 - Icon Updates and UI Polish

- [x] Replace `New Folder` button with a 16x16 folder icon (static/icons/folder.png)
- [x] Replace `New Note` button with a 16x16 file icon (static/icons/file.png)
- [x] Replace the `Settings` button text with a 16x16 settings icon (static/icons/settings.png)

## v1.2.2 - File Tree Structure and Header Layout

- [x] Move the settings button to the right side of the file tree footer
- [x] Replace the `Notes` text in the file tree header with the Index page title
- [x] Move `Build | Tag: ...` to the left side of the file tree footer, mirroring the settings button position
- [x] Remove the Index page title bar entirely

## v1.2.1 - Settings Simplification

- [x] Remove `Automatically pull application updates when a new version is available` from settings and code
- [x] Remove `Application auto-pull interval (minutes)` from settings and code
- [x] Move `Export Notebook` and `Import Notebook` buttons into the settings modal under the General section

## v1.2.0 - Tree and UI Alignment

- [x] Close all tree items when the page initially loads

## v1.1.9 - Move stored settings into notes folder

- [x] Move the notebooks settings into the root notes folder as a JSON file. This way they travel with the notes. 
- [x] Hide dot files from the file tree
- [x] Make border around code windows (``` ```) thinner ~ 2 pixels

## v1.1.8 - Update sub-title on index page with version

- [x] Add a setting for the index page title which is currently hard coded to `NoteBooks`.
- [x] Set the build number (number of commits) and tag (if it exists) for the top-bar-subtitle text on the index page. Use github api key configured in .env.

## v1.1.7 - Version Revisioning

- [x] Initialize and connect a dedicated Git repository for the notes folder (`notes/`), using the remote `https://github.com/testbenchcc/markdown-notes.git`.
- [x] Add a setting to automatically commit changes inside the notes folder and push them to the dedicated notes repository.
- [x] Add a setting to automatically pull updates from the dedicated notes repository.
- [x] Add settings for the notes repository location (local path under `notes/` and remote URL) and the GitHub API key.
  - Always commit and push local notes changes before pulling from the notes repository. Do not push if the local branch is out of sync with its remote. This should not happen since I am the only user, but the safeguard still needs to be there.
- [x] Add a setting to auto pull when a new version of the application is released. Include an interval setting for how often to check. Ensure that application auto-pull never overwrites the `notes/` folder, since it is now a separate, git-ignored notes repository. Usse the remote `https://github.com/testbenchcc/markdown-notes-app.git`

## v1.1.6 - Note export improvements

- [x] Add a default theme selection to the settings modal Appearance category for the exported theme default. (implemented)
- [x] Update note exporting to use the selected theme. (implemented)

## v1.1.5 - Themes

- [x] Implement a theme/Appearance selection. Allow for index to switch between multiple style.css files. Keep the existing styles.css file, but create variations of it to swap in (or whatever the best practice is, just keep it simple). Utilize the settings modal. Reload when the selection is made so the user can preview the change, but do not make it permanent until settings are applied. (implemented)
- [x] Create a professional theme for office settings. I still want a bit of color, not just black and white. (implemented)
- [x] Create a high contrast theme. (implemented)

## v1.1.4 - Settings modal

- [x] Add a modal for settings. Set its width to 80 percent of screen width. Much like Obsidian, have catigory selection on the left, and the catigories settings on the right. The save button should be for the entire modal, instead of page by page. Change the color of the category if something is changed. I would like this modal html to go into its own file to keep things organized and easy to edit. (implemented)

## v1.1.x – Advanced features (optional)

- [x] Improve markdown rendering. (Code rendering within ``` fences and table outlines) (implemented)
- [x] Export/import utility (export and import notebook as zip file). (implemented)
  - Include: ./.git, ./notes, ./static, docker-compose.yml, Dockerfile, main.py, requirements.txt
- [x] Export note to html document. (implemented)
- [x] Improve coloring for markdown using @.\example files\Obsidian gruvbox. (implemented)

## v1.x – Search and UX

- [x] Add simple text search across markdown files. (implemented)
- [x] Improve tree UX (keyboard navigation, better folder icons). (implemented)
- [x] Add context menu for tree items. (implemented)

## v1.x – Quality of life

- [x] Improve error messages in the UI (failed loads/saves, invalid paths). (implemented)
- [x] Remember last selected note in `localStorage`. (implemented)
- [x] Optional environment variable to override the notes root folder. (implemented)
- [ ] Basic unit tests for filesystem operations. (ignore task for now)
- [x] Fix `New Note` creation so notes are saved with `.md` extension and immediately appear in the notes tree. (implemented)

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
