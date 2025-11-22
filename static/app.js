(function () {
  const treeContainer = document.getElementById("tree");
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const viewerEl = document.getElementById("viewer");
  const editorEl = document.getElementById("editor");
  const editorWrapperEl = document.getElementById("editor-wrapper");
  const editorLineNumbersEl = document.getElementById("editor-line-numbers");
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
  const importFileInput = document.getElementById("import-file-input");
  const noteExportBtn = document.getElementById("note-export-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const themeLinkEl = document.getElementById("theme-stylesheet");
  const pageTitleEl = document.querySelector("title");
  const navTitleEl = document.getElementById("nav-title");
  const navFooterBuildEl = document.getElementById("nav-footer-build");

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
  let settingsIndexPageTitleInput = null;
  let settingsThemeSelect = null;
  let settingsExportThemeSelect = null;
  let settingsAutoCommitNotesInput = null;
  let settingsAutoPullNotesInput = null;
  let settingsAutoPullIntervalInput = null;

  let notesAutoPullTimerId = null;

  let lastViewerScrollTop = 0;
  let lastEditorScrollTop = 0;

  let expandedFolderPaths = new Set();

  function updateEditorLineNumbers() {
    if (!editorEl || !editorLineNumbersEl) {
      return;
    }
    const value = editorEl.value || "";
    const lineCount = value ? value.split("\n").length : 1;
    let lines = "";
    for (let i = 1; i <= lineCount; i++) {
      lines += i;
      if (i < lineCount) {
        lines += "\n";
      }
    }
    editorLineNumbersEl.textContent = lines;
  }

  function syncEditorLineNumbersScroll() {
    if (!editorEl || !editorLineNumbersEl) {
      return;
    }
    editorLineNumbersEl.scrollTop = editorEl.scrollTop;
  }

  let versioningNotesRootEl = null;
  let versioningNotesRemoteUrlEl = null;
  let versioningGithubApiKeyStatusEl = null;
  let versioningViewAppHistoryBtn = null;
  let versioningViewNotesHistoryBtn = null;
  let versioningGitHistoryPopupEl = null;
  let versioningGitHistoryTitleEl = null;
  let versioningGitHistoryBodyEl = null;
  let versioningGitHistoryCloseBtn = null;

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
    "midnight": {
      href: "/static/styles-midnight.css",
    },
  };

  const DEFAULT_THEME_ID = "office";

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
      exportTheme: "match-app-theme",
      autoCommitNotes: false,
      autoPullNotes: false,
      autoPullIntervalMinutes: 30,
      indexPageTitle: "NoteBooks",
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

  async function loadSettingsFromServerOrStorage() {
    try {
      const remote = await fetchJSON("/api/settings");
      const merged = {
        ...getDefaultSettings(),
        ...(remote && typeof remote === "object" ? remote : {}),
      };
      saveSettingsToStorage(merged);
      return merged;
    } catch (e) {
      return loadSettingsFromStorage();
    }
  }

  async function saveSettingsToServer(settings) {
    const base = getDefaultSettings();
    const input = settings && typeof settings === "object" ? settings : {};
    try {
      const remote = await fetchJSON("/api/settings", {
        method: "PUT",
        body: JSON.stringify(input),
      });
      const merged = {
        ...base,
        ...(remote && typeof remote === "object" ? remote : {}),
      };
      saveSettingsToStorage(merged);
      return merged;
    } catch (e) {
      const merged = {
        ...base,
        ...input,
      };
      saveSettingsToStorage(merged);
      throw e;
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
    applyIndexTitle(settings);
  }

  function applyIndexTitle(settings) {
    const value = (settings && settings.indexPageTitle) || "NoteBooks";
    if (navTitleEl) {
      navTitleEl.textContent = value;
    }
    if (pageTitleEl) {
      if (pageTitleEl.textContent !== value) {
        pageTitleEl.textContent = value;
      }
    } else if (document && document.title !== value) {
      document.title = value;
    }
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
    const spellcheckDirty =
      !!draftSettings.editorSpellcheck !== !!savedSettings.editorSpellcheck;
    const titleDirty =
      (draftSettings.indexPageTitle || "") !==
      (savedSettings.indexPageTitle || "");
    setSettingsCategoryDirty("general", spellcheckDirty || titleDirty);
  }

  function updateVersioningCategoryDirty() {
    if (!savedSettings || !draftSettings) {
      return;
    }
    const autoCommitDirty =
      !!draftSettings.autoCommitNotes !== !!savedSettings.autoCommitNotes;
    const autoPullDirty =
      !!draftSettings.autoPullNotes !== !!savedSettings.autoPullNotes;
    const intervalDirty =
      Number(draftSettings.autoPullIntervalMinutes || 0) !==
      Number(savedSettings.autoPullIntervalMinutes || 0);
    const dirty = autoCommitDirty || autoPullDirty || intervalDirty;
    setSettingsCategoryDirty("versioning", dirty);
  }

  function syncSettingsControlsFromDraft() {
    if (!settingsOverlayEl || !draftSettings) {
      return;
    }
    if (settingsEditorSpellcheckInput) {
      settingsEditorSpellcheckInput.checked = !!draftSettings.editorSpellcheck;
    }
    if (settingsIndexPageTitleInput) {
      settingsIndexPageTitleInput.value = draftSettings.indexPageTitle || "";
    }
    if (settingsAutoCommitNotesInput) {
      settingsAutoCommitNotesInput.checked = !!draftSettings.autoCommitNotes;
    }
    if (settingsAutoPullNotesInput) {
      settingsAutoPullNotesInput.checked = !!draftSettings.autoPullNotes;
    }
    if (settingsAutoPullIntervalInput) {
      const minutes = draftSettings.autoPullIntervalMinutes || 0;
      settingsAutoPullIntervalInput.value = minutes > 0 ? String(minutes) : "";
    }
    if (settingsThemeSelect) {
      const themeId = draftSettings.theme || DEFAULT_THEME_ID;
      settingsThemeSelect.value = themeId;
    }
    if (settingsExportThemeSelect) {
      const exportTheme = draftSettings.exportTheme || "match-app-theme";
      settingsExportThemeSelect.value = exportTheme;
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
    settingsIndexPageTitleInput = root.querySelector(
      "#settings-index-page-title"
    );
    settingsThemeSelect = root.querySelector("#settings-theme");
    settingsExportThemeSelect = root.querySelector("#settings-export-theme");
    settingsAutoCommitNotesInput = root.querySelector(
      "#settings-auto-commit-notes"
    );
    settingsAutoPullNotesInput = root.querySelector(
      "#settings-auto-pull-notes"
    );
    settingsAutoPullIntervalInput = root.querySelector(
      "#settings-auto-pull-interval"
    );
    versioningNotesRootEl = root.querySelector("#versioning-notes-root");
    versioningNotesRemoteUrlEl = root.querySelector(
      "#versioning-notes-remote-url"
    );
    versioningGithubApiKeyStatusEl = root.querySelector(
      "#versioning-github-api-key-status"
    );
    versioningViewAppHistoryBtn = root.querySelector(
      "#versioning-view-app-history-btn"
    );
    versioningViewNotesHistoryBtn = root.querySelector(
      "#versioning-view-notes-history-btn"
    );
    versioningGitHistoryPopupEl = root.querySelector(
      "#versioning-git-history-popup"
    );
    versioningGitHistoryTitleEl = root.querySelector(
      "#versioning-git-history-title"
    );
    versioningGitHistoryBodyEl = root.querySelector(
      "#versioning-git-history-body"
    );
    versioningGitHistoryCloseBtn = root.querySelector(
      "#versioning-git-history-close-btn"
    );
    const settingsExportNotebookBtn = root.querySelector(
      "#settings-export-notebook-btn"
    );
    const settingsImportNotebookBtn = root.querySelector(
      "#settings-import-notebook-btn"
    );

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

    if (settingsIndexPageTitleInput) {
      settingsIndexPageTitleInput.addEventListener("input", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        draftSettings.indexPageTitle = settingsIndexPageTitleInput.value || "";
        updateGeneralCategoryDirty();
      });
    }

    if (settingsAutoCommitNotesInput) {
      settingsAutoCommitNotesInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        draftSettings.autoCommitNotes = !!settingsAutoCommitNotesInput.checked;
        updateVersioningCategoryDirty();
      });
    }

    if (settingsAutoPullNotesInput) {
      settingsAutoPullNotesInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        draftSettings.autoPullNotes = !!settingsAutoPullNotesInput.checked;
        updateVersioningCategoryDirty();
      });
    }

    if (settingsAutoPullIntervalInput) {
      settingsAutoPullIntervalInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const raw = settingsAutoPullIntervalInput.value;
        let minutes = parseInt(raw, 10);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          minutes = 0;
        }
        draftSettings.autoPullIntervalMinutes = minutes;
        updateVersioningCategoryDirty();
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

    if (settingsExportThemeSelect) {
      settingsExportThemeSelect.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const value = settingsExportThemeSelect.value || "match-app-theme";
        draftSettings.exportTheme = value;
        setSettingsCategoryDirty("appearance", true);
      });
    }

    if (settingsExportNotebookBtn) {
      settingsExportNotebookBtn.addEventListener("click", (e) => {
        e.preventDefault();
        downloadExport();
      });
    }

    if (settingsImportNotebookBtn) {
      settingsImportNotebookBtn.addEventListener("click", (e) => {
        e.preventDefault();
        triggerImportFilePicker();
      });
    }

    if (versioningViewAppHistoryBtn) {
      versioningViewAppHistoryBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadGitHistory("app");
      });
    }

    if (versioningViewNotesHistoryBtn) {
      versioningViewNotesHistoryBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadGitHistory("notes");
      });
    }

    if (versioningGitHistoryCloseBtn && versioningGitHistoryPopupEl) {
      versioningGitHistoryCloseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        hideGitHistoryPopup();
      });
    }

    async function saveSettingsAndClose() {
      if (!draftSettings) {
        draftSettings = savedSettings
          ? { ...savedSettings }
          : getDefaultSettings();
      }
      let nextSettings = { ...draftSettings };
      try {
        const saved = await saveSettingsToServer(nextSettings);
        nextSettings = { ...saved };
      } catch (err) {
        showError(`Failed to sync settings to notebook: ${err.message}`);
      }
      savedSettings = nextSettings;
      applySettings(savedSettings);
      clearAllSettingsCategoryDirty();
      updateNotesAutoPullTimerFromSettings();
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
    savedSettings = await loadSettingsFromServerOrStorage();
    draftSettings = { ...savedSettings };
    syncSettingsControlsFromDraft();
    clearAllSettingsCategoryDirty();
    updateGeneralCategoryDirty();
    updateVersioningCategoryDirty();
    refreshVersioningStatus();
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

  async function refreshVersioningStatus() {
    try {
      const data = await fetchJSON("/api/versioning/status");
      if (versioningNotesRootEl) {
        versioningNotesRootEl.textContent = data.notes_root || "Unknown";
      }
      if (versioningNotesRemoteUrlEl) {
        versioningNotesRemoteUrlEl.textContent =
          data.notes_remote_url || "Unknown";
      }
      if (versioningGithubApiKeyStatusEl) {
        versioningGithubApiKeyStatusEl.textContent =
          data.github_api_key_configured ? "Configured" : "Not configured";
      }
    } catch (err) {
      if (versioningNotesRootEl) {
        versioningNotesRootEl.textContent = "Unavailable";
      }
      if (versioningNotesRemoteUrlEl) {
        versioningNotesRemoteUrlEl.textContent = "Unavailable";
      }
      if (versioningGithubApiKeyStatusEl) {
        versioningGithubApiKeyStatusEl.textContent = "Unavailable";
      }
    }
  }

  function hideGitHistoryPopup() {
    if (!versioningGitHistoryPopupEl) {
      return;
    }
    versioningGitHistoryPopupEl.classList.add("hidden");
    if (versioningGitHistoryBodyEl) {
      versioningGitHistoryBodyEl.innerHTML = "";
    }
  }

  function showGitHistoryPopup(kind, data) {
    if (
      !versioningGitHistoryPopupEl ||
      !versioningGitHistoryBodyEl ||
      !versioningGitHistoryTitleEl
    ) {
      return;
    }

    const owner = data && data.owner ? data.owner : "";
    const repo = data && data.repo ? data.repo : "";
    const remote = data && data.remote_url ? data.remote_url : "";
    const commits = Array.isArray(data && data.commits) ? data.commits : [];
    const releases = Array.isArray(data && data.releases) ? data.releases : [];
    const tags = Array.isArray(data && data.tags) ? data.tags : [];

    const lines = [];
    if (owner || repo) {
      lines.push(`Repository: ${owner || "?"}/${repo || "?"}`);
    }
    if (remote) {
      lines.push(`Remote: ${remote}`);
    }
    lines.push("");

    if (commits.length) {
      lines.push("Commits:");
      commits.forEach((c) => {
        const shortSha = c && c.short_sha ? c.short_sha : "";
        const title = c && c.title ? c.title : "";
        const message = c && c.message ? c.message : "";
        lines.push(`- ${shortSha} ${title}`);
        if (message && message !== title) {
          lines.push(`    ${message}`);
        }
      });
      lines.push("");
    }

    if (releases.length) {
      lines.push("Releases:");
      releases.forEach((r) => {
        const tagName = r && r.tag_name ? r.tag_name : "";
        const name = r && r.name ? r.name : "";
        const body = r && r.body ? r.body : "";
        lines.push(`- ${tagName} ${name}`);
        if (body) {
          lines.push(`    ${body}`);
        }
      });
      lines.push("");
    }

    if (tags.length) {
      lines.push("Tags:");
      tags.forEach((t) => {
        const name = t && t.name ? t.name : "";
        const msg = t && t.tag_message ? t.tag_message : "";
        lines.push(`- ${name} ${msg}`);
      });
      lines.push("");
    }

    if (!lines.length) {
      lines.push("No history data available.");
    }

    const pre = document.createElement("pre");
    pre.textContent = lines.join("\n");

    versioningGitHistoryBodyEl.innerHTML = "";
    versioningGitHistoryBodyEl.appendChild(pre);

    if (kind === "app") {
      versioningGitHistoryTitleEl.textContent =
        "Application repository history";
    } else {
      versioningGitHistoryTitleEl.textContent = "Notes repository history";
    }

    versioningGitHistoryPopupEl.classList.remove("hidden");
  }

  async function loadGitHistory(kind) {
    const url =
      kind === "app"
        ? "/api/versioning/app/history"
        : "/api/versioning/notes/history";
    try {
      clearError();
      const data = await fetchJSON(url);
      showGitHistoryPopup(kind, data);
    } catch (err) {
      const label = kind === "app" ? "application" : "notes";
      showError(`Failed to load ${label} repository history: ${err.message}`);
    }
  }

  async function refreshAppVersionSubtitle() {
    if (!navFooterBuildEl) {
      return;
    }
    try {
      const data = await fetchJSON("/api/versioning/app/info");
      const build =
        typeof data.build_number === "number" ? data.build_number : null;
      const tag = data.latest_tag || null;
      const parts = [];
      if (build !== null) {
        parts.push(`Build ${build}`);
      }
      if (tag) {
        parts.push(`Tag ${tag}`);
      }
      if (!parts.length) {
        navFooterBuildEl.textContent = "";
        return;
      }
      navFooterBuildEl.textContent = parts.join(" | ");
    } catch (err) {
      navFooterBuildEl.textContent = "";
    }
  }

  function updateNotesAutoPullTimerFromSettings() {
    if (notesAutoPullTimerId !== null) {
      window.clearInterval(notesAutoPullTimerId);
      notesAutoPullTimerId = null;
    }
    const settings = savedSettings || getDefaultSettings();
    if (!settings.autoPullNotes) {
      return;
    }
    const minutes = Number(settings.autoPullIntervalMinutes || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    const intervalMs = minutes * 60 * 1000;
    notesAutoPullTimerId = window.setInterval(() => {
      triggerNotesAutoPull();
    }, intervalMs);
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
      const settings = savedSettings || getDefaultSettings();
      let exportTheme = settings.exportTheme || "match-app-theme";
      if (exportTheme === "match-app-theme") {
        exportTheme = settings.theme || DEFAULT_THEME_ID;
      }
      let url = `/api/export-note/${encodedPath}`;
      if (exportTheme && THEME_DEFINITIONS[exportTheme]) {
        const params = new URLSearchParams();
        params.set("theme", exportTheme);
        url = `${url}?${params.toString()}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Request failed (${res.status}): ${text}`);
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const baseName = currentNote.name || "note.md";
      const nameWithoutExt = baseName.replace(/\.md$/i, "") || "note";
      a.download = `${nameWithoutExt}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
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

  function renderMermaidInViewer() {
    if (!viewerEl) {
      return;
    }
    const mermaidGlobal = window.mermaid;
    if (!mermaidGlobal) {
      return;
    }
    const targets = Array.from(viewerEl.querySelectorAll(".mermaid"));
    if (!targets.length) {
      return;
    }
    try {
      if (typeof mermaidGlobal.initialize === "function") {
        mermaidGlobal.initialize({ startOnLoad: false });
      }
      if (typeof mermaidGlobal.init === "function") {
        mermaidGlobal.init(undefined, targets);
      } else if (typeof mermaidGlobal.run === "function") {
        mermaidGlobal.run({ nodes: targets });
      }
    } catch (e) {}
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
      // Save editor scroll position before switching to view
      lastEditorScrollTop = editorEl.scrollTop;

      viewerEl.classList.remove("hidden");
      if (editorWrapperEl) {
        editorWrapperEl.classList.add("hidden");
      } else {
        editorEl.classList.add("hidden");
      }
      const modeIcon = modeToggleBtn.querySelector("img");
      if (modeIcon) {
        modeIcon.src = "/static/icons/edit.png";
        modeIcon.alt = "Edit";
      }
      modeToggleBtn.setAttribute("aria-label", "Edit");
      modeToggleBtn.setAttribute("title", "Edit");
      saveBtn.disabled = true;

      // Restore viewer scroll position
      viewerEl.scrollTop = lastViewerScrollTop;
    } else {
      // Save viewer scroll position before switching to edit
      lastViewerScrollTop = viewerEl.scrollTop;

      viewerEl.classList.add("hidden");
      if (editorWrapperEl) {
        editorWrapperEl.classList.remove("hidden");
      } else {
        editorEl.classList.remove("hidden");
      }
      const modeIcon = modeToggleBtn.querySelector("img");
      if (modeIcon) {
        modeIcon.src = "/static/icons/reader.png";
        modeIcon.alt = "Reader";
      }
      modeToggleBtn.setAttribute("aria-label", "Reader");
      modeToggleBtn.setAttribute("title", "Reader");
      saveBtn.disabled = false;
      editorEl.focus();

      // Restore editor scroll position
      editorEl.scrollTop = lastEditorScrollTop;
      syncEditorLineNumbersScroll();
    }
  }

  async function loadTree() {
    try {
      clearError();
      hideContextMenu();
      captureExpandedFolders();
      const tree = await fetchJSON("/api/tree");
      renderTree(tree);
    } catch (err) {
      treeContainer.textContent = "Failed to load tree.";
      showError(`Failed to load tree: ${err.message}`);
    }
  }

  function captureExpandedFolders() {
    if (!treeContainer) return;
    const items = treeContainer.querySelectorAll(".tree-item.folder.expanded");
    const next = new Set();
    items.forEach((item) => {
      const path = item.dataset.path;
      if (typeof path === "string" && path) {
        next.add(path);
      }
    });
    expandedFolderPaths = next;
  }

  function restoreExpandedFolders() {
    if (!treeContainer || !expandedFolderPaths || expandedFolderPaths.size === 0) {
      return;
    }
    const items = treeContainer.querySelectorAll(".tree-item.folder");
    items.forEach((item) => {
      const path = item.dataset.path;
      if (typeof path === "string" && expandedFolderPaths.has(path)) {
        const childrenContainer = item.nextElementSibling;
        if (
          childrenContainer &&
          childrenContainer.classList.contains("tree-children")
        ) {
          item.classList.add("expanded");
          childrenContainer.style.display = "block";
        }
      }
    });
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
    restoreExpandedFolders();
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

    const icon = document.createElement("span");
    icon.classList.add("tree-icon");
    item.appendChild(icon);

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
      const childrenContainer = document.createElement("div");
      childrenContainer.classList.add("tree-children");
      childrenContainer.style.display = "none";

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
      renderMermaidInViewer();
      editorEl.value = note.content || "";
      updateEditorLineNumbers();
      modeToggleBtn.disabled = false;
      if (noteExportBtn) {
        noteExportBtn.disabled = false;
      }
      setMode("view");
    } catch (err) {
      viewerEl.textContent = "Failed to load note.";
      editorEl.value = "";
      updateEditorLineNumbers();
      currentNote = null;
      modeToggleBtn.disabled = true;
      saveBtn.disabled = true;
      if (noteExportBtn) {
        noteExportBtn.disabled = true;
      }
      showError(`Failed to load note: ${err.message}`);
    }
  }

  async function triggerNotesAutoCommit() {
    try {
      const settings = savedSettings || getDefaultSettings();
      if (!settings.autoCommitNotes) {
        return;
      }
      await fetchJSON("/api/versioning/notes/commit-and-push", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch (err) {
      showError(`Failed to sync notes repository: ${err.message}`);
    }
  }

  async function triggerNotesAutoPull() {
    try {
      const settings = savedSettings || getDefaultSettings();
      if (!settings.autoPullNotes) {
        return;
      }
      await fetchJSON("/api/versioning/notes/pull", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch (err) {
      showError(`Failed to pull notes repository: ${err.message}`);
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
      await triggerNotesAutoCommit();
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
      
      // Find and select the newly created note
      const treeItems = document.querySelectorAll(".tree-item.note");
      for (const el of treeItems) {
        if (el.dataset.path === path) {
          clearSelection();
          el.classList.add("selected");
          await loadNote(path);
          // Switch to edit mode for the new note
          setMode("edit");
          break;
        }
      }
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
        updateEditorLineNumbers();
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

  if (editorEl) {
    editorEl.addEventListener("input", () => {
      updateEditorLineNumbers();
    });
    editorEl.addEventListener("scroll", () => {
      syncEditorLineNumbersScroll();
    });
  }

  newFolderBtn.addEventListener("click", () => {
    promptNewFolder("");
  });

  newNoteBtn.addEventListener("click", () => {
    promptNewNote("");
  });

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

  async function initApp() {
    savedSettings = await loadSettingsFromServerOrStorage();
    draftSettings = { ...savedSettings };
    applySettings(savedSettings);
    updateNotesAutoPullTimerFromSettings();
    setupSplitter();
    await loadTree();
    await refreshAppVersionSubtitle();
  }

  initApp();
})();
