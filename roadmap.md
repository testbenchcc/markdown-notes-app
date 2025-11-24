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

## v0.4.2 - Menu update

- [x] Replace the ad-hoc rename prompt with the Fancytree `ext-edit` inline editor so double-click, click-active, Shift+click, and F2 all trigger rename.
  - [x] Validate inline rename input (trim, forbid slashes, enforce `.md` suffix for notes) before calling existing rename endpoints.
  - [x] Reuse existing `/api/notes/rename` and `/api/folders/rename` flows, refreshing the tree and reloading renamed notes in place.
  - [x] Keep the legacy prompt as a fallback so renaming still works if inline editing cannot start.

```html
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="content-type" content="text/html; charset=ISO-8859-1">
  <title>Fancytree - Editable Nodes</title>

  <script src="//code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="//code.jquery.com/ui/1.13.0/jquery-ui.min.js"></script>

  <link href="../src/skin-win8/ui.fancytree.css" rel="stylesheet">
  <script src="../src/jquery.fancytree.js"></script>
  <script src="../src/jquery.fancytree.edit.js"></script>

  <!-- (Irrelevant source removed.) -->

<style type="text/css">
  span.pending span.fancytree-title {
    font-style: italic;
  }
  span.pending span.fancytree-title:after {
    content: "\2026"; /* ellipsis */
  }
</style>

<script type="text/javascript">
$(function(){
  $("#tree").fancytree({
    extensions: ["edit"],
    source: {url: "ajax-tree-products.json"},
    // source: {url: "ajax-tree-plain.json"},
    lazyLoad: function(event, data) {
      data.result = { url: "ajax-sub2.json", debugDelay: 1000 };
    },
    edit: {
      triggerStart: ["clickActive", "dblclick", "f2", "mac+enter", "shift+click"],
      beforeEdit: function(event, data){
        // Return false to prevent edit mode
      },
      edit: function(event, data){
        // Editor was opened (available as data.input)
      },
      beforeClose: function(event, data){
        // Return false to prevent cancel/save (data.input is available)
        console.log(event.type, event, data);
        if( data.originalEvent.type === "mousedown" ) {
          // We could prevent the mouse click from generating a blur event
          // (which would then again close the editor) and return `false` to keep
          // the editor open:
//                  data.originalEvent.preventDefault();
//                  return false;
          // Or go on with closing the editor, but discard any changes:
//                  data.save = false;
        }
      },
      save: function(event, data){
        // Save data.input.val() or return false to keep editor open
        console.log("save...", this, data);
        // Simulate to start a slow ajax request...
        setTimeout(function(){
          $(data.node.span).removeClass("pending");
          // Let's pretend the server returned a slightly modified
          // title:
          data.node.setTitle(data.node.title + "!");
        }, 2000);
        // We return true, so ext-edit will set the current user input
        // as title
        return true;
      },
      close: function(event, data){
        // Editor was removed
        if( data.save ) {
          // Since we started an async request, mark the node as preliminary
          $(data.node.span).addClass("pending");
        }
      }
    }
  });
});
</script>

<!-- (Irrelevant source removed.) -->

</head>

<body class="example">
  <h1>Example: 'edit' extension</h1>
  <div class="description">
    <p>
      Rename or create nodes using inline editing.
    </p>
    <p>
      Edit the node titles with `dblclick`, `Shift + click` [F2], or [Enter] (on Mac only).
      Also a `slow click` (click again into already active node).
    </p>
    <p>
      <b>Status:</b> production.
      <b>Details:</b>
      <a href="https://github.com/mar10/fancytree/wiki/ExtEdit"
        target="_blank" class="external">ext-edit</a>.
    </p>
  </div>
  <div>
    <label for="skinswitcher">Skin:</label> <select id="skinswitcher"></select>
  </div>

  <div id="tree">
  </div>

  <!-- (Irrelevant source removed.) -->
</body>
</html>
```



## v0.5.0 – Search & Filters Enhancements

- **Backend**
  - [x] Review and, if necessary, optimize `/api/search` for typical notebook sizes.
    - GET URLs so seach can be shared (query is stored in `?search=` and restored on load).
  - [x] Ensure safe handling of search queries and limits on results.

 - **Frontend**
  - [x] Integrate search results more tightly with the tree and content pane.
    - Search box calls `/api/search` and clicking a result opens the note and syncs tree selection.
  - [-] Provide filters (e.g., note vs image, path-based narrowing) as reasonable. (ignore for now)
  - [x] Optionally highlight search matches within notes.
    - Clicking a search result switches to edit mode and highlights the full line in Monaco so the match is visually located.


## v0.6.0 – Images & Paste Workflow Hardening

 - **Backend**
  - [x] Revisit `/api/images/paste` to ensure:
    - [x] File type validation and size limits from settings.
    - [x] Robust error responses for oversized or invalid images.
  - [x] Confirm image storage structure (subfolder, naming scheme) is stable.
  - [x] Cleanup routine for unused images (if selected)

 - **Frontend**
  - [x] Ensure pasted images integrate smoothly with Monaco editor:
    - [x] Insert returned markdown snippets at cursor.
    - [x] Provide clear error messages for rejected pastes.
  - [x] display upload progress using a progress bar made of hash markd [##############################################------------------------]
    - Use a banner in the editor panel. Do not shift the panel downd overlay the banner so contents do not shift.
    - The width of the progress bar should expand to fit, leave a little padding on the sides.
    - apear when the download starts, display during upload, and when finished, quickly display the response, then go away. 
  - [x] Confirm viewer behavior for image sizing (fit-width vs max-size, max width/height) matches settings. (Alignment options still TBD.)
  - [x] Three storeage options for images
    - [x] flat: dump everything in one folder
    - [x] matched: put everything in a matched structure inside the Image storage subfolder
    - [x] local: save them in a subfolder within the same folder as the note. (include setting for folder name) (default option)
  - [x] Additional settings for settings modal.
    - [x] File handling, Image display mode, Fit to note width, Max image width (px) (default of 768), Max image height (px) (default of 768), Image storage subfolder (default of /Images) (only used if local not selected), Max pasted image size (MB), Images maintenance, Run image cleanup

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

