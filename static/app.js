(function () {
  const treeContainer = document.getElementById("tree");
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const viewerEl = document.getElementById("viewer");
  const editorEl = document.getElementById("editor");
  const modeToggleBtn = document.getElementById("mode-toggle-btn");
  const saveBtn = document.getElementById("save-btn");
  const errorBannerEl = document.getElementById("error-banner");
  const newFolderBtn = document.getElementById("new-folder-btn");
  const newNoteBtn = document.getElementById("new-note-btn");
  const divider = document.getElementById("divider");
  const navPane = document.getElementById("nav-pane");
  const mainEl = document.getElementById("main");
  const searchInputEl = document.getElementById("search-input");
  const searchResultsEl = document.getElementById("search-results");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFileInput = document.getElementById("import-file-input");
  const noteExportBtn = document.getElementById("note-export-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const themeLinkEl = document.getElementById("theme-stylesheet");

  const contextMenuEl = document.createElement("div");
  contextMenuEl.id = "context-menu";
  contextMenuEl.className = "context-menu hidden";
  document.body.appendChild(contextMenuEl);

  let contextMenuTarget = null;
  let contextMenuTargetEl = null;

  let currentNote = null; // { path, name, content, html }
  let mode = "view"; // "view" | "edit"

  const SETTINGS_STORAGE_KEY = "markdownNotesSettings";
  let savedSettings = null;
  let draftSettings = null;
  let settingsOverlayEl = null;
  let settingsInitialized = false;
  let settingsEditorSpellcheckInput = null;
  let settingsThemeSelect = null;

  const THEME_DEFINITIONS = {
    "gruvbox-dark": {
      href: "/static/styles.css",
    },
    office: {
      href: "/static/styles-office.css",
    },
    "high-contrast": {
      href: "/static/styles-high-contrast.css",
    },
  };

  const DEFAULT_THEME_ID = "gruvbox-dark";

  function applyTheme(themeId) {
    if (!themeLinkEl) {
      return;
    }
    let id = themeId;
    if (!id || !THEME_DEFINITIONS[id]) {
      id = DEFAULT_THEME_ID;
    }
    const def = THEME_DEFINITIONS[id];
    if (!def || !def.href) {
      return;
    }
    if (themeLinkEl.getAttribute("href") !== def.href) {
      themeLinkEl.setAttribute("href", def.href);
    }
  }

  function getDefaultSettings() {
    return {
      editorSpellcheck: false,
      theme: DEFAULT_THEME_ID,
    };
  }

  function loadSettingsFromStorage() {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return getDefaultSettings();
      }
      const raw = storage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        return getDefaultSettings();
      }
      const parsed = JSON.parse(raw);
      return {
        ...getDefaultSettings(),
        ...parsed,
      };
    } catch (e) {
      return getDefaultSettings();
    }
  }

  function saveSettingsToStorage(settings) {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return;
      }
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      // Ignore storage errors
    }
  }

  function applySettings(settings) {
    if (!settings) {
      return;
    }
    if (editorEl) {
      editorEl.spellcheck = !!settings.editorSpellcheck;
    }
    applyTheme(settings.theme);
  }

  function setSettingsCategoryDirty(categoryId, dirty) {
    if (!settingsOverlayEl) {
      return;
    }
    const navItem = settingsOverlayEl.querySelector(
      `.settings-nav-item[data-category="${categoryId}"]`
    );
    if (!navItem) {
      return;
    }
    if (dirty) {
      navItem.classList.add("settings-nav-item-dirty");
    } else {
      navItem.classList.remove("settings-nav-item-dirty");
    }
  }

  function clearAllSettingsCategoryDirty() {
    if (!settingsOverlayEl) {
      return;
    }
    const dirtyItems = settingsOverlayEl.querySelectorAll(
      ".settings-nav-item-dirty"
    );
    dirtyItems.forEach((el) => el.classList.remove("settings-nav-item-dirty"));
  }

  function updateGeneralCategoryDirty() {
    if (!savedSettings || !draftSettings) {
      return;
    }
    const dirty =
      !!draftSettings.editorSpellcheck !== !!savedSettings.editorSpellcheck;
    setSettingsCategoryDirty("general", dirty);
  }

  function syncSettingsControlsFromDraft() {
    if (!settingsOverlayEl || !draftSettings) {
      return;
    }
    if (settingsEditorSpellcheckInput) {
      settingsEditorSpellcheckInput.checked = !!draftSettings.editorSpellcheck;
    }
    if (settingsThemeSelect) {
      const themeId = draftSettings.theme || DEFAULT_THEME_ID;
      settingsThemeSelect.value = themeId;
    }
  }

  function attachSettingsModalHandlers(root) {
    if (!root || settingsInitialized) {
      return;
    }

    settingsOverlayEl = root;
    const navItems = Array.from(root.querySelectorAll(".settings-nav-item"));
    const panels = Array.from(
      root.querySelectorAll(".settings-category-panel")
    );
    const saveButton = root.querySelector("#settings-save-btn");
    const cancelButton = root.querySelector("#settings-cancel-btn");
    const closeButton = root.querySelector("#settings-close-btn");

    settingsEditorSpellcheckInput = root.querySelector(
      "#settings-editor-spellcheck"
    );
    settingsThemeSelect = root.querySelector("#settings-theme");

    function selectCategory(categoryId) {
      navItems.forEach((btn) => {
        const id = btn.dataset.category || "";
        if (id === categoryId) {
          btn.classList.add("selected");
        } else {
          btn.classList.remove("selected");
        }
      });
      panels.forEach((panel) => {
        const id = panel.dataset.category || "";
        if (id === categoryId) {
          panel.classList.remove("hidden");
        } else {
          panel.classList.add("hidden");
        }
      });
    }

    navItems.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const categoryId = btn.dataset.category || "";
        if (!categoryId) {
          return;
        }
        selectCategory(categoryId);
      });
    });

    if (settingsEditorSpellcheckInput) {
      settingsEditorSpellcheckInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        draftSettings.editorSpellcheck = !!settingsEditorSpellcheckInput.checked;
        updateGeneralCategoryDirty();
      });
    }

    if (settingsThemeSelect) {
      settingsThemeSelect.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const selectedTheme = settingsThemeSelect.value || DEFAULT_THEME_ID;
        draftSettings.theme = selectedTheme;
        setSettingsCategoryDirty("appearance", true);
        applyTheme(selectedTheme);
      });
    }

    function saveSettingsAndClose() {
      if (!draftSettings) {
        draftSettings = savedSettings
          ? { ...savedSettings }
          : getDefaultSettings();
      }
      savedSettings = { ...draftSettings };
      saveSettingsToStorage(savedSettings);
      applySettings(savedSettings);
      clearAllSettingsCategoryDirty();
      closeSettingsModal();
    }

    function cancelSettingsAndClose() {
      draftSettings = savedSettings
        ? { ...savedSettings }
        : getDefaultSettings();
      syncSettingsControlsFromDraft();
      clearAllSettingsCategoryDirty();
      applySettings(savedSettings);
      closeSettingsModal();
    }

    if (saveButton) {
      saveButton.addEventListener("click", (e) => {
        e.preventDefault();
        saveSettingsAndClose();
      });
    }

    if (cancelButton) {
      cancelButton.addEventListener("click", (e) => {
        e.preventDefault();
        cancelSettingsAndClose();
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", (e) => {
        e.preventDefault();
        cancelSettingsAndClose();
      });
    }

    root.addEventListener("click", (e) => {
      if (e.target === root) {
        e.preventDefault();
        cancelSettingsAndClose();
      }
    });

    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelSettingsAndClose();
      }
    });

    if (navItems.length) {
      const initialCategory = navItems[0].dataset.category || "";
      if (initialCategory) {
        selectCategory(initialCategory);
      }
    }

    settingsInitialized = true;
  }

  async function ensureSettingsModalLoaded() {
    if (settingsOverlayEl) {
      return;
    }
    try {
      const res = await fetch("/static/settings-modal.html");
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || "Unable to load settings UI.");
      }
      const wrapper = document.createElement("div");
      wrapper.innerHTML = text.trim();
      const root = wrapper.firstElementChild;
      if (!root) {
        throw new Error("Settings modal HTML is empty.");
      }
      document.body.appendChild(root);
      attachSettingsModalHandlers(root);
    } catch (err) {
      showError(`Failed to open settings: ${err.message}`);
    }
  }

  async function openSettingsModal() {
    await ensureSettingsModalLoaded();
    if (!settingsOverlayEl) {
      return;
    }
    savedSettings = loadSettingsFromStorage();
    draftSettings = { ...savedSettings };
    syncSettingsControlsFromDraft();
    clearAllSettingsCategoryDirty();
    updateGeneralCategoryDirty();
    settingsOverlayEl.classList.remove("hidden");
    document.body.classList.add("settings-open");
    const firstNav = settingsOverlayEl.querySelector(".settings-nav-item");
    if (firstNav && typeof firstNav.focus === "function") {
      firstNav.focus();
    }
  }

  function closeSettingsModal() {
    if (!settingsOverlayEl) {
      return;
    }
    settingsOverlayEl.classList.add("hidden");
    document.body.classList.remove("settings-open");
  }

  async function fetchJSON(url, options) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  function clearSelection() {
    for (const el of document.querySelectorAll(".tree-item")) {
      el.classList.remove("selected");
    }
  }

  async function downloadCurrentNoteHtml() {
    if (!currentNote || !currentNote.path) return;
    try {
      clearError();
      const encodedPath = encodeURIComponent(currentNote.path);
      const res = await fetch(`/api/export-note/${encodedPath}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Request failed (${res.status}): ${text}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = currentNote.name || "note.md";
      const nameWithoutExt = baseName.replace(/\.md$/i, "") || "note";
      a.download = `${nameWithoutExt}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showError(`Failed to export note: ${err.message}`);
    }
  }

  function showError(message) {
    if (!errorBannerEl) return;
    errorBannerEl.textContent = message;
    errorBannerEl.classList.remove("hidden");
  }

  function clearError() {
    if (!errorBannerEl) return;
    errorBannerEl.textContent = "";
    errorBannerEl.classList.add("hidden");
  }

  function clearSearchResults() {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = "";
    searchResultsEl.classList.add("hidden");
  }

  function renderSearchResults(payload) {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = "";

    if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-results-empty";
      empty.textContent = "No results";
      searchResultsEl.appendChild(empty);
      searchResultsEl.classList.remove("hidden");
      return;
    }

    const header = document.createElement("div");
    header.className = "search-results-header";
    const label = document.createElement("span");
    label.textContent = `Search: "${payload.query || ""}"`;
    const count = document.createElement("span");
    count.textContent = `${payload.results.length} note(s)`;
    header.appendChild(label);
    header.appendChild(count);
    searchResultsEl.appendChild(header);

    payload.results.forEach((result) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-result-item";

      const pathEl = document.createElement("div");
      pathEl.className = "search-result-path";
      pathEl.textContent = result.path || result.name || "";

      const snippetEl = document.createElement("div");
      snippetEl.className = "search-result-snippet";
      if (Array.isArray(result.matches) && result.matches.length > 0) {
        const first = result.matches[0];
        const prefix = first.line_number ? `${first.line_number}: ` : "";
        snippetEl.textContent = `${prefix}${first.line || ""}`;
      }

      item.appendChild(pathEl);
      item.appendChild(snippetEl);

      const path = result.path;
      if (path) {
        item.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          clearSelection();
          const treeItems = document.querySelectorAll(".tree-item.note");
          let matched = false;
          for (const el of treeItems) {
            if (el.dataset.path === path) {
              el.classList.add("selected");
              matched = true;
              break;
            }
          }
          await loadNote(path);
          if (!matched) {
            try {
              const storage = window.localStorage;
              if (storage) {
                storage.setItem("lastNotePath", path);
              }
            } catch (e) {
              // Ignore storage errors
            }
          }
        });
      }

      searchResultsEl.appendChild(item);
    });

    searchResultsEl.classList.remove("hidden");
  }

  async function handleSearchInput() {
    if (!searchInputEl || !searchResultsEl) return;
    const query = searchInputEl.value.trim();
    if (!query) {
      clearSearchResults();
      return;
    }
    if (query.length < 2) {
      searchResultsEl.classList.remove("hidden");
      searchResultsEl.innerHTML = "";
      const info = document.createElement("div");
      info.className = "search-results-empty";
      info.textContent = "Type at least 2 characters to search.";
      searchResultsEl.appendChild(info);
      return;
    }
    try {
      clearError();
      searchResultsEl.classList.remove("hidden");
      searchResultsEl.innerHTML = "";
      const loading = document.createElement("div");
      loading.className = "search-results-empty";
      loading.textContent = "Searching…";
      searchResultsEl.appendChild(loading);
      const payload = await fetchJSON(`/api/search?q=${encodeURIComponent(query)}`);
      renderSearchResults(payload);
    } catch (err) {
      showError(`Failed to search notes: ${err.message}`);
      searchResultsEl.classList.remove("hidden");
      searchResultsEl.innerHTML = "";
      const errorEl = document.createElement("div");
      errorEl.className = "search-results-empty";
      errorEl.textContent = "Search failed.";
      searchResultsEl.appendChild(errorEl);
    }
  }

  async function downloadExport() {
    try {
      clearError();
      const res = await fetch("/api/export");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Request failed (${res.status}): ${text}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "markdown-notes-notebook.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showError(`Failed to export notebook: ${err.message}`);
    }
  }

  async function importNotebookFromFile(file, force) {
    if (!file) return;
    try {
      clearError();
      const formData = new FormData();
      formData.append("file", file);
      const url = force ? "/api/import?force=true" : "/api/import";
      const res = await fetch(url, {
        method: "POST",
        body: formData,
      });

      if (res.status === 409) {
        let payload;
        try {
          payload = await res.json();
        } catch (e) {
          throw new Error("Import conflict and response could not be parsed.");
        }

        if (
          payload &&
          payload.reason === "older_notes" &&
          Array.isArray(payload.conflicts)
        ) {
          const count = payload.conflicts.length;
          const message =
            count === 1
              ? "The imported notebook contains an older version of 1 note. Restore it and overwrite your newer note?"
              : `The imported notebook contains older versions of ${count} notes. Restore them and overwrite your newer notes?`;
          const proceed = window.confirm(message);
          if (!proceed) {
            showError(
              "Import cancelled: existing newer notes were kept. No files were overwritten."
            );
            return;
          }

          await importNotebookFromFile(file, true);
          return;
        }

        throw new Error("Import failed with a conflict.");
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Import failed (${res.status}): ${text}`);
      }

      await res.json();
      await loadTree();
    } catch (err) {
      showError(`Failed to import notebook: ${err.message}`);
    }
  }

  function triggerImportFilePicker() {
    if (!importFileInput) return;
    importFileInput.value = "";
    importFileInput.click();
  }

  function hideContextMenu() {
    if (!contextMenuEl) return;
    contextMenuEl.classList.add("hidden");
    contextMenuEl.innerHTML = "";
    contextMenuTarget = null;
    contextMenuTargetEl = null;
  }

  function buildContextMenuItems(target) {
    const items = [];

    if (target.type === "folder") {
      const isRoot = !target.path;
      items.push({
        id: "new-note",
        label: isRoot ? "New note" : "New note in folder",
      });
      items.push({
        id: "new-folder",
        label: isRoot ? "New folder" : "New subfolder",
      });
      if (!isRoot) {
        items.push({ separator: true });
        items.push({ id: "rename", label: "Rename folder" });
        items.push({ id: "delete", label: "Delete folder" });
      }
      items.push({ separator: true });
      items.push({
        id: "copy-path",
        label: isRoot ? "Copy notebook root path" : "Copy folder path",
      });
    } else if (target.type === "note") {
      items.push({ id: "open-note", label: "Open note" });
      items.push({ id: "rename", label: "Rename note" });
      items.push({ id: "delete", label: "Delete note" });
      items.push({ separator: true });
      items.push({ id: "copy-path", label: "Copy note path" });
    }

    contextMenuEl.innerHTML = "";

    items.forEach((def) => {
      if (def.separator) {
        const sep = document.createElement("div");
        sep.className = "context-menu-separator";
        contextMenuEl.appendChild(sep);
        return;
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "context-menu-item";
      btn.textContent = def.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleContextMenuAction(def.id);
      });
      contextMenuEl.appendChild(btn);
    });
  }

  function showContextMenuForItem(item, clientX, clientY) {
    if (!contextMenuEl) return;

    const type = item.classList.contains("folder") ? "folder" : "note";
    const path = item.dataset.path || "";

    contextMenuTarget = { type, path };
    contextMenuTargetEl = item;

    buildContextMenuItems(contextMenuTarget);

    contextMenuEl.style.left = "0px";
    contextMenuEl.style.top = "0px";
    contextMenuEl.classList.remove("hidden");

    const rect = contextMenuEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = clientX;
    let y = clientY;

    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 4;
    }
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 4;
    }
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
  }

  async function handleContextMenuAction(actionId) {
    if (!contextMenuTarget) {
      hideContextMenu();
      return;
    }

    const { type, path } = contextMenuTarget;
    const targetEl = contextMenuTargetEl;

    hideContextMenu();

    if (actionId === "copy-path") {
      const value = path || "/";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          window.prompt("Path", value);
        }
      } catch (err) {
        window.prompt("Path", value);
      }
      return;
    }

    if (type === "folder") {
      if (actionId === "new-note") {
        await promptNewNote(path || "");
      } else if (actionId === "new-folder") {
        await promptNewFolder(path || "");
      } else if (actionId === "rename") {
        await renameItem("folder", path || "");
      } else if (actionId === "delete") {
        await deleteItem("folder", path || "");
      }
      return;
    }

    if (type === "note") {
      if (actionId === "open-note" && path) {
        if (targetEl) {
          clearSelection();
          targetEl.classList.add("selected");
        }
        await loadNote(path);
      } else if (actionId === "rename" && path) {
        await renameItem("note", path);
      } else if (actionId === "delete" && path) {
        await deleteItem("note", path);
      }
    }
  }

  function setMode(nextMode) {
    mode = nextMode;
    if (!currentNote) {
      modeToggleBtn.disabled = true;
      saveBtn.disabled = true;
      return;
    }

    if (mode === "view") {
      viewerEl.classList.remove("hidden");
      editorEl.classList.add("hidden");
      modeToggleBtn.textContent = "View";
      saveBtn.disabled = true;
    } else {
      viewerEl.classList.add("hidden");
      editorEl.classList.remove("hidden");
      modeToggleBtn.textContent = "Edit";
      saveBtn.disabled = false;
      editorEl.focus();
    }
  }

  async function loadTree() {
    try {
      clearError();
      hideContextMenu();
      const tree = await fetchJSON("/api/tree");
      renderTree(tree);
    } catch (err) {
      treeContainer.textContent = "Failed to load tree.";
      showError(`Failed to load tree: ${err.message}`);
    }
  }

  function renderTree(root) {
    treeContainer.innerHTML = "";
    if (!root || !Array.isArray(root.children)) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No notes yet";
      treeContainer.appendChild(empty);
      return;
    }

    root.children.forEach((child) => {
      renderNode(child, treeContainer, 0);
    });
    restoreLastSelection();
  }

  function restoreLastSelection() {
    try {
      const storage = window.localStorage;
      if (!storage) return;
      const lastPath = storage.getItem("lastNotePath");
      if (!lastPath) return;
      const items = document.querySelectorAll(".tree-item.note");
      for (const el of items) {
        if (el.dataset.path === lastPath) {
          clearSelection();
          el.classList.add("selected");
          loadNote(lastPath);
          break;
        }
      }
    } catch (e) {
      // Ignore storage errors
    }
  }

  function getVisibleTreeItems() {
    if (!treeContainer) return [];
    const items = Array.from(treeContainer.querySelectorAll(".tree-item"));
    return items.filter((el) => el.offsetParent !== null);
  }

  function getSelectedTreeItem() {
    return document.querySelector(".tree-item.selected");
  }

  function focusTreeItem(item) {
    if (!item) return;
    clearSelection();
    item.classList.add("selected");
    if (typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }

  function findParentFolder(item) {
    if (!item) return null;
    let parent = item.parentElement;
    while (parent && parent !== treeContainer) {
      if (parent.classList.contains("tree-children")) {
        const folder = parent.previousElementSibling;
        if (
          folder &&
          folder.classList.contains("tree-item") &&
          folder.classList.contains("folder")
        ) {
          return folder;
        }
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function renderNode(node, container, depth) {
    const item = document.createElement("div");
    item.classList.add("tree-item", node.type);

    item.dataset.path = typeof node.path === "string" ? node.path : "";

    const label = document.createElement("span");
    label.classList.add("label");
    label.textContent = node.name || "notes";
    label.style.paddingLeft = `${depth * 12 + 4}px`;
    item.appendChild(label);

    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenuForItem(item, e.clientX, e.clientY);
    });

    if (node.type === "folder") {
      item.classList.add("expanded");
      const childrenContainer = document.createElement("div");
      childrenContainer.classList.add("tree-children");

      label.addEventListener("click", (e) => {
        e.stopPropagation();
        const expanded = item.classList.toggle("expanded");
        if (expanded) {
          childrenContainer.style.display = "block";
        } else {
          childrenContainer.style.display = "none";
        }
      });

      container.appendChild(item);
      container.appendChild(childrenContainer);

      if (Array.isArray(node.children)) {
        node.children.forEach((child) => {
          renderNode(child, childrenContainer, depth + 1);
        });
      }
    } else {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        clearSelection();
        item.classList.add("selected");
        await loadNote(node.path);
      });
      container.appendChild(item);
    }
  }

  async function loadNote(path) {
    try {
      clearError();
      const note = await fetchJSON(`/api/notes/${encodeURIComponent(path)}`);
      currentNote = note;
      try {
        const storage = window.localStorage;
        if (storage) {
          storage.setItem("lastNotePath", note.path);
        }
      } catch (e) {
        // Ignore storage errors
      }
      noteNameEl.textContent = note.name;
      notePathEl.textContent = note.path;
      viewerEl.innerHTML = note.html || "";
      editorEl.value = note.content || "";
      modeToggleBtn.disabled = false;
      if (noteExportBtn) {
        noteExportBtn.disabled = false;
      }
      setMode("view");
    } catch (err) {
      viewerEl.textContent = "Failed to load note.";
      editorEl.value = "";
      currentNote = null;
      modeToggleBtn.disabled = true;
      saveBtn.disabled = true;
      if (noteExportBtn) {
        noteExportBtn.disabled = true;
      }
      showError(`Failed to load note: ${err.message}`);
    }
  }

  async function saveCurrentNote() {
    if (!currentNote) return;
    try {
      clearError();
      const updatedContent = editorEl.value;
      await fetchJSON(`/api/notes/${encodeURIComponent(currentNote.path)}`, {
        method: "PUT",
        body: JSON.stringify({ content: updatedContent }),
      });
      // Reload to update rendered HTML
      await loadNote(currentNote.path);
    } catch (err) {
      showError(`Failed to save note: ${err.message}`);
    }
  }

  async function promptNewFolder(parentFolderPath) {
    const base = parentFolderPath && parentFolderPath.trim()
      ? parentFolderPath.trim().replace(/\/+$/, "")
      : "";
    const message = base
      ? `New folder name inside '${base}' (e.g. 'projects' or 'personal')`
      : "New folder path (relative to notes root, e.g. 'projects' or 'work/personal')";
    const input = window.prompt(message, "");
    if (!input) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const path = base ? `${base}/${trimmed}` : trimmed;
    try {
      clearError();
      await fetchJSON("/api/folders", {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      await loadTree();
    } catch (err) {
      showError(`Failed to create folder: ${err.message}`);
    }
  }

  async function promptNewNote(parentFolderPath) {
    const base = parentFolderPath && parentFolderPath.trim()
      ? parentFolderPath.trim().replace(/\/+$/, "")
      : "";
    const message = base
      ? `New note name inside '${base}' (e.g. 'todo' or 'meeting-notes'; '.md' will be added automatically)`
      : "New note path (relative to notes root, e.g. 'inbox' or 'work/todo'; '.md' will be added automatically)";
    const defaultValue = base ? "untitled" : "";
    const input = window.prompt(message, defaultValue);
    if (!input) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    if (/[\\/\\]$/.test(trimmed)) {
      showError("Note path must include a file name, not just a folder.");
      return;
    }
    let path = base ? `${base}/${trimmed}` : trimmed;
    if (!path.toLowerCase().endsWith(".md")) {
      path = `${path}.md`;
    }
    try {
      clearError();
      await fetchJSON("/api/notes", {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      await loadTree();
    } catch (err) {
      showError(`Failed to create note: ${err.message}`);
    }
  }

  async function renameItem(type, currentPath) {
    if (!currentPath) return;

    const isNote = type === "note";
    const label = isNote ? "note" : "folder";
    const example = isNote ? "work/todo.md" : "projects/archive";
    const input = window.prompt(
      `New ${label} path (relative to notes root, e.g. '${example}')`,
      currentPath
    );
    if (!input) return;
    let newPath = input.trim();
    if (!newPath) return;
    if (isNote && !newPath.toLowerCase().endsWith(".md")) {
      newPath = `${newPath}.md`;
    }

    try {
      clearError();
      await fetchJSON("/api/rename", {
        method: "POST",
        body: JSON.stringify({ old_path: currentPath, new_path: newPath }),
      });
      await loadTree();

      if (isNote) {
        try {
          const storage = window.localStorage;
          if (storage) {
            storage.setItem("lastNotePath", newPath);
          }
        } catch (e) {
          // Ignore storage errors
        }
        await loadNote(newPath);
      }
    } catch (err) {
      showError(`Failed to rename ${label}: ${err.message}`);
    }
  }

  async function deleteItem(type, path) {
    if (!path) return;

    const label = type === "note" ? "note" : "folder";
    const message =
      type === "note"
        ? `Delete note '${path}'? This cannot be undone.`
        : `Delete folder '${path}' and all its contents? This cannot be undone.`;
    if (!window.confirm(message)) return;

    try {
      clearError();
      await fetchJSON("/api/delete", {
        method: "POST",
        body: JSON.stringify({ path }),
      });

      if (
        type === "note" &&
        currentNote &&
        currentNote.path === path
      ) {
        viewerEl.textContent = "";
        editorEl.value = "";
        currentNote = null;
        modeToggleBtn.disabled = true;
        saveBtn.disabled = true;
        if (noteExportBtn) {
          noteExportBtn.disabled = true;
        }
        noteNameEl.textContent = "No note selected";
        notePathEl.textContent = "";
        try {
          const storage = window.localStorage;
          if (storage && storage.getItem("lastNotePath") === path) {
            storage.removeItem("lastNotePath");
          }
        } catch (e) {
          // Ignore storage errors
        }
      }

      await loadTree();
    } catch (err) {
      showError(`Failed to delete ${label}: ${err.message}`);
    }
  }

  function setupSplitter() {
    let dragging = false;

    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.classList.add("resizing");
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const rect = mainEl.getBoundingClientRect();
      let offsetX = e.clientX - rect.left;
      const min = 150;
      const max = rect.width - 220;
      if (offsetX < min) offsetX = min;
      if (offsetX > max) offsetX = max;
      const percent = (offsetX / rect.width) * 100;
      navPane.style.flexBasis = `${percent}%`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("resizing");
    });
  }

  window.addEventListener("click", (e) => {
    if (contextMenuEl.classList.contains("hidden")) return;
    if (contextMenuEl.contains(e.target)) return;
    hideContextMenu();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
      return;
    }

    if (!treeContainer) return;

    const active = document.activeElement;
    if (active !== treeContainer) {
      return;
    }

    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight" &&
      e.key !== "Home" &&
      e.key !== "End" &&
      e.key !== "Enter" &&
      e.key !== " "
    ) {
      return;
    }

    e.preventDefault();

    const items = getVisibleTreeItems();
    if (!items.length) {
      return;
    }

    let current = getSelectedTreeItem();
    if (!current) {
      current = items[0];
      focusTreeItem(current);
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        return;
      }
    }

    const currentIndex = items.indexOf(current);

    if (e.key === "ArrowDown") {
      const next = items[currentIndex + 1];
      if (next) {
        focusTreeItem(next);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      const prev = items[currentIndex - 1];
      if (prev) {
        focusTreeItem(prev);
      }
      return;
    }

    if (e.key === "Home") {
      focusTreeItem(items[0]);
      return;
    }

    if (e.key === "End") {
      focusTreeItem(items[items.length - 1]);
      return;
    }

    const isFolder = current.classList.contains("folder");
    const isNote = current.classList.contains("note");

    if (e.key === "ArrowRight") {
      if (isFolder) {
        const expanded = current.classList.contains("expanded");
        const childrenContainer = current.nextElementSibling;
        if (!expanded) {
          current.classList.add("expanded");
          if (
            childrenContainer &&
            childrenContainer.classList.contains("tree-children")
          ) {
            childrenContainer.style.display = "block";
          }
        } else {
          const next = items[currentIndex + 1];
          if (next) {
            focusTreeItem(next);
          }
        }
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      if (isFolder && current.classList.contains("expanded")) {
        const childrenContainer = current.nextElementSibling;
        if (
          childrenContainer &&
          childrenContainer.classList.contains("tree-children")
        ) {
          childrenContainer.style.display = "none";
        }
        current.classList.remove("expanded");
      } else {
        const parentFolder = findParentFolder(current);
        if (parentFolder) {
          focusTreeItem(parentFolder);
        }
      }
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      if (isFolder) {
        const childrenContainer = current.nextElementSibling;
        const expanded = current.classList.toggle("expanded");
        if (
          childrenContainer &&
          childrenContainer.classList.contains("tree-children")
        ) {
          childrenContainer.style.display = expanded ? "block" : "none";
        }
      } else if (isNote) {
        current.click();
      }
    }
  });

  treeContainer.addEventListener("scroll", () => {
    if (!contextMenuEl.classList.contains("hidden")) {
      hideContextMenu();
    }
  });

  // Wire up controls
  modeToggleBtn.addEventListener("click", () => {
    if (!currentNote) return;
    setMode(mode === "view" ? "edit" : "view");
  });

  saveBtn.addEventListener("click", () => {
    if (!currentNote) return;
    saveCurrentNote();
  });

  if (noteExportBtn) {
    noteExportBtn.addEventListener("click", () => {
      if (!currentNote) return;
      downloadCurrentNoteHtml();
    });
  }

  newFolderBtn.addEventListener("click", () => {
    promptNewFolder("");
  });

  newNoteBtn.addEventListener("click", () => {
    promptNewNote("");
  });

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      downloadExport();
    });
  }

  if (importBtn) {
    importBtn.addEventListener("click", () => {
      triggerImportFilePicker();
    });
  }

  if (importFileInput) {
    importFileInput.addEventListener("change", () => {
      const files = importFileInput.files;
      if (!files || !files.length) return;
      const file = files[0];
      importNotebookFromFile(file, false);
    });
  }

  if (searchInputEl) {
    searchInputEl.addEventListener("input", () => {
      handleSearchInput();
    });
    searchInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        searchInputEl.value = "";
        clearSearchResults();
      }
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      openSettingsModal();
    });
  }

  savedSettings = loadSettingsFromStorage();
  draftSettings = { ...savedSettings };
  applySettings(savedSettings);

  setupSplitter();
  loadTree();
})();
