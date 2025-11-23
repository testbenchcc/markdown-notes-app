(function () {
  const treeContainer = document.getElementById("tree");
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const viewerEl = document.getElementById("viewer");
  const editorEl = document.getElementById("editor");
  const editorWrapperEl = document.getElementById("editor-wrapper");
  const editorLineNumbersEl = document.getElementById("editor-line-numbers");
  const modeToggleBtn = document.getElementById("mode-toggle-btn");
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
  let currentImage = null; // { path, name }
  let mode = "view"; // "view" | "edit"

  const SETTINGS_STORAGE_KEY = "markdownNotesSettings";
  let savedSettings = null;
  let draftSettings = null;
  let settingsOverlayEl = null;
  let settingsInitialized = false;
  let settingsEditorSpellcheckInput = null;
  let settingsIndexPageTitleInput = null;
  let settingsTabLengthInput = null;
  let settingsDateFormatInput = null;
  let settingsTimeFormatInput = null;
  let settingsImageDisplayModeSelect = null;
  let settingsImageMaxWidthInput = null;
  let settingsImageMaxHeightInput = null;
  let settingsImageDefaultAlignmentSelect = null;
  let settingsThemeSelect = null;
  let settingsExportThemeSelect = null;
  let settingsAutoCommitNotesInput = null;
  let settingsAutoPullNotesInput = null;
  let settingsAutoPullIntervalInput = null;
  let settingsAutoSaveIntervalInput = null;
  let settingsImagesStoragePathInput = null;
  let settingsImagesMaxSizeMbInput = null;
  let settingsImagesCleanupBtn = null;

  let notesAutoPullTimerId = null;
  let notesAutoSaveTimerId = null;

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

  function applyImageDisplaySettingsInViewer(settings) {
    if (!viewerEl) {
      return;
    }
    const baseSettings =
      (settings && typeof settings === "object" && settings) ||
      savedSettings ||
      getDefaultSettings();

    const mode = (baseSettings.imageDisplayMode || "fit-width").trim();
    const maxWidth = Number(baseSettings.imageMaxDisplayWidth || 0);
    const maxHeight = Number(baseSettings.imageMaxDisplayHeight || 0);
    const align = (baseSettings.imageDefaultAlignment || "left").trim();

    const images = viewerEl.querySelectorAll("img");
    images.forEach((img) => {
      if (!img) return;

      img.style.maxWidth = "";
      img.style.maxHeight = "";
      img.style.width = "";
      img.style.height = "";
      img.style.marginLeft = "";
      img.style.marginRight = "";

      if (mode === "fit-width") {
        img.style.width = "100%";
        img.style.height = "auto";
        if (maxWidth > 0) {
          img.style.maxWidth = `${maxWidth}px`;
        }
        if (maxHeight > 0) {
          img.style.maxHeight = `${maxHeight}px`;
        }
      } else if (mode === "max-size") {
        img.style.height = "auto";
        if (maxWidth > 0) {
          img.style.maxWidth = `${maxWidth}px`;
        }
        if (maxHeight > 0) {
          img.style.maxHeight = `${maxHeight}px`;
        }
      }

      let block = img;
      const parent = img.parentElement;
      if (
        parent &&
        parent.tagName === "P" &&
        parent.children.length === 1 &&
        parent.querySelector("img") === img
      ) {
        block = parent;
      }

      block.style.textAlign = "";

      if (align === "center") {
        block.style.textAlign = "center";
      } else if (align === "right") {
        block.style.textAlign = "right";
      } else {
        block.style.textAlign = "left";
      }
    });
  }

  function syncEditorLineNumbersScroll() {
    if (!editorEl || !editorLineNumbersEl) {
      return;
    }
    editorLineNumbersEl.scrollTop = editorEl.scrollTop;
  }

  function getScrollPercent(el) {
    if (!el) {
      return 0;
    }
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) {
      return 0;
    }
    return el.scrollTop / max;
  }

  function setScrollPercent(el, percent) {
    if (!el) {
      return;
    }
    const clamped = percent < 0 ? 0 : percent > 1 ? 1 : percent;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) {
      el.scrollTop = 0;
      return;
    }
    el.scrollTop = clamped * max;
  }

  function insertTextAtCursor(textarea, text) {
    if (!textarea) {
      return;
    }
    const value = textarea.value || "";
    const start =
      typeof textarea.selectionStart === "number"
        ? textarea.selectionStart
        : value.length;
    const end =
      typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const nextValue = before + text + after;
    textarea.value = nextValue;
    const nextPos = start + text.length;
    try {
      textarea.selectionStart = nextPos;
      textarea.selectionEnd = nextPos;
    } catch (e) {
      // Ignore selection errors
    }
    if (
      window.markdownEditorHighlighter &&
      typeof window.markdownEditorHighlighter.refresh === "function"
    ) {
      window.markdownEditorHighlighter.refresh();
    }
  }

  function getTextSelectionInfo(textarea) {
    if (!textarea) {
      return {
        value: "",
        start: 0,
        end: 0,
        before: "",
        selected: "",
        after: "",
      };
    }
    const value = textarea.value || "";
    let start =
      typeof textarea.selectionStart === "number"
        ? textarea.selectionStart
        : 0;
    let end =
      typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    return {
      value,
      start,
      end,
      before: value.slice(0, start),
      selected: value.slice(start, end),
      after: value.slice(end),
    };
  }

  function setTextAndSelection(textarea, nextValue, selectionStart, selectionEnd) {
    if (!textarea) {
      return;
    }
    const value = String(nextValue || "");
    textarea.value = value;
    let start =
      typeof selectionStart === "number" ? selectionStart : value.length;
    let end =
      typeof selectionEnd === "number" ? selectionEnd : start;
    if (start < 0) {
      start = 0;
    }
    if (end < start) {
      end = start;
    }
    if (end > value.length) {
      end = value.length;
    }
    try {
      textarea.selectionStart = start;
      textarea.selectionEnd = end;
    } catch (e) {
      // Ignore selection errors
    }
  }

  function wrapSelectionWithMarkers(textarea, leftMarker, rightMarker) {
    const left = leftMarker || "";
    const right =
      typeof rightMarker === "string" && rightMarker.length
        ? rightMarker
        : left;
    const info = getTextSelectionInfo(textarea);
    const { value, start, end, before, selected, after } = info;
    const hasSelection = end > start;
    const inner = hasSelection ? selected : "";
    const prefixLen = left.length;
    const suffixLen = right.length;

    if (
      hasSelection &&
      prefixLen &&
      suffixLen &&
      start >= prefixLen &&
      value.length >= end + suffixLen
    ) {
      const prefixStart = start - prefixLen;
      const prefix = value.slice(prefixStart, start);
      const suffix = value.slice(end, end + suffixLen);
      if (prefix === left && suffix === right) {
        const newBefore = value.slice(0, prefixStart);
        const newSelected = inner;
        const newAfter = value.slice(end + suffixLen);
        const newValue = newBefore + newSelected + newAfter;
        const newStart = prefixStart;
        const newEnd = newStart + newSelected.length;
        setTextAndSelection(textarea, newValue, newStart, newEnd);
        return;
      }
    }

    const insertText = left + (inner || "") + right;
    const newBefore = before;
    const newAfter = after;
    const newValue = newBefore + insertText + newAfter;
    const newStart = newBefore.length + left.length;
    const newEnd = newStart + inner.length;
    setTextAndSelection(textarea, newValue, newStart, newEnd);
  }

  function getSelectedLinesInfo(textarea) {
    if (!textarea) {
      return {
        value: "",
        start: 0,
        end: 0,
        lineStart: 0,
        lineEnd: 0,
        before: "",
        block: "",
        after: "",
      };
    }
    const value = textarea.value || "";
    let start =
      typeof textarea.selectionStart === "number"
        ? textarea.selectionStart
        : 0;
    let end =
      typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    const length = value.length;
    let lineStart = value.lastIndexOf("\n", start - 1);
    if (lineStart === -1) {
      lineStart = 0;
    } else {
      lineStart += 1;
    }
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) {
      lineEnd = length;
    }
    const before = value.slice(0, lineStart);
    const block = value.slice(lineStart, lineEnd);
    const after = value.slice(lineEnd);
    return {
      value,
      start,
      end,
      lineStart,
      lineEnd,
      before,
      block,
      after,
    };
  }

  function replaceSelectedLines(textarea, transformLine) {
    const info = getSelectedLinesInfo(textarea);
    const lines = info.block.split("\n");
    const transformed = lines.map((line) =>
      typeof transformLine === "function" ? transformLine(line) : line
    );
    const nextBlock = transformed.join("\n");
    const nextValue = info.before + nextBlock + info.after;
    const nextStart = info.lineStart;
    const nextEnd = nextStart + nextBlock.length;
    setTextAndSelection(textarea, nextValue, nextStart, nextEnd);
  }

  function indentSelectedLines(textarea, tabString) {
    const indent = tabString || "  ";
    replaceSelectedLines(textarea, (line) => indent + line);
  }

  function unindentSelectedLines(textarea, tabString) {
    const indent = tabString || "  ";
    replaceSelectedLines(textarea, (line) => {
      if (!line) {
        return line;
      }
      if (indent && line.startsWith(indent)) {
        return line.slice(indent.length);
      }
      if (line.startsWith("\t")) {
        return line.slice(1);
      }
      if (line.startsWith("    ")) {
        return line.slice(2);
      }
      if (line.startsWith(" ")) {
        return line.replace(/^ {1,4}/, "");
      }
      return line;
    });
  }

  function duplicateSelectedLines(textarea) {
    const info = getSelectedLinesInfo(textarea);
    const block = info.block || "";
    const before = info.before;
    const after = info.after;
    const insert = block + "\n" + block;
    const nextValue = before + insert + after;
    const firstBlockStart = info.lineStart;
    const secondBlockStart = firstBlockStart + block.length + 1;
    const secondBlockEnd = secondBlockStart + block.length;
    setTextAndSelection(textarea, nextValue, secondBlockStart, secondBlockEnd);
  }

  function toggleChecklistLines(textarea) {
    replaceSelectedLines(textarea, (line) => {
      const taskMatch = line.match(/^(\s*)- \[( |x|X)\] (.*)$/);
      if (taskMatch) {
        const indent = taskMatch[1] || "";
        const body = taskMatch[3] || "";
        return indent + body;
      }
      if (!line.trim()) {
        return line;
      }
      const bulletMatch = line.match(/^(\s*)- (.*)$/);
      if (bulletMatch) {
        const indent = bulletMatch[1] || "";
        const body = bulletMatch[2] || "";
        return indent + "- [ ] " + body;
      }
      const genericMatch = line.match(/^(\s*)(.*)$/);
      const indent = (genericMatch && genericMatch[1]) || "";
      const body = (genericMatch && genericMatch[2]) || "";
      return indent + "- [ ] " + body.trim();
    });
  }

  function toggleBulletLines(textarea) {
    replaceSelectedLines(textarea, (line) => {
      if (/^(\s*)- \[( |x|X)\] /.test(line)) {
        return line;
      }
      const bulletMatch = line.match(/^(\s*)- (.*)$/);
      if (bulletMatch) {
        const indent = bulletMatch[1] || "";
        const body = bulletMatch[2] || "";
        return indent + body;
      }
      if (!line.trim()) {
        return line;
      }
      const genericMatch = line.match(/^(\s*)(.*)$/);
      const indent = (genericMatch && genericMatch[1]) || "";
      const body = (genericMatch && genericMatch[2]) || "";
      return indent + "- " + body.trim();
    });
  }

  function toggleOrderedLines(textarea) {
    replaceSelectedLines(textarea, (line) => {
      const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
      if (orderedMatch) {
        const indent = orderedMatch[1] || "";
        const body = orderedMatch[2] || "";
        return indent + body;
      }
      if (!line.trim()) {
        return line;
      }
      const genericMatch = line.match(/^(\s*)(.*)$/);
      const indent = (genericMatch && genericMatch[1]) || "";
      const body = (genericMatch && genericMatch[2]) || "";
      return indent + "1. " + body.trim();
    });
  }

  function toggleHeadingLevel(textarea) {
    replaceSelectedLines(textarea, (line) => {
      if (!line.trim()) {
        return line;
      }
      const headingMatch = line.match(/^(\s*)(#{1,6})\s+(.*)$/);
      let indent = "";
      let level = 0;
      let text = line.trim();
      if (headingMatch) {
        indent = headingMatch[1] || "";
        level = (headingMatch[2] || "").length;
        text = headingMatch[3] || "";
      } else {
        const genericMatch = line.match(/^(\s*)(.*)$/);
        indent = (genericMatch && genericMatch[1]) || "";
        text = (genericMatch && genericMatch[2]) || "";
      }
      let nextLevel = 0;
      if (level === 0) {
        nextLevel = 1;
      } else if (level === 1) {
        nextLevel = 2;
      } else if (level === 2) {
        nextLevel = 3;
      } else if (level === 3) {
        nextLevel = 4;
      } else if (level === 4) {
        nextLevel = 5;
      } else if (level === 5) {
        nextLevel = 6;
      } else {
        nextLevel = 0;
      }
      if (nextLevel === 0) {
        return indent + text;
      }
      const hashes = "#".repeat(nextLevel);
      return `${indent}${hashes} ${text}`;
    });
  }

  function toggleInlineCodeSelection(textarea) {
    wrapSelectionWithMarkers(textarea, "`", "`");
  }

  function toggleFenceBlockSelection(textarea) {
    const info = getTextSelectionInfo(textarea);
    const { selected } = info;
    if (!selected) {
      const placeholder = "```\n\n```";
      insertTextAtCursor(textarea, placeholder);
      return;
    }
    const trimmed = selected.trim();
    if (/^```[\s\S]*```$/.test(trimmed)) {
      const inner = trimmed
        .replace(/^```[^\n]*\n?/, "")
        .replace(/```$/, "");
      const leading = selected.match(/^\s*/)[0];
      const trailingMatch = selected.match(/\s*$/);
      const trailing = trailingMatch ? trailingMatch[0] : "";
      const plain = leading + inner + trailing;
      const before = info.before;
      const after = info.after;
      const nextValue = before + plain + after;
      const nextStart = before.length + leading.length;
      const nextEnd = nextStart + inner.length;
      setTextAndSelection(textarea, nextValue, nextStart, nextEnd);
      return;
    }
    const before = info.before;
    const after = info.after;
    const fenced = `\`\`\`\n${selected}\n\`\`\``;
    const nextValue = before + fenced + after;
    const nextStart = before.length + 4;
    const nextEnd = nextStart + selected.length;
    setTextAndSelection(textarea, nextValue, nextStart, nextEnd);
  }

  function insertLinkSelection(textarea, isImage) {
    const info = getTextSelectionInfo(textarea);
    const before = info.before;
    const selected = info.selected || "";
    const after = info.after;
    const label = selected || "text";
    const prefix = isImage ? "![" : "[";
    const open = prefix;
    const closeLabel = "](";
    const suffix = ")";
    const body = `${open}${label}${closeLabel}${suffix}`;
    const nextValue = before + body + after;
    const cursorPos = before.length + open.length + label.length + closeLabel.length;
    setTextAndSelection(textarea, nextValue, cursorPos, cursorPos);
  }

  function getEditorCodeState(textarea) {
    if (!textarea) {
      return {
        insideInline: false,
        insideFence: false,
        inside: false,
      };
    }
    const value = textarea.value || "";
    const index =
      typeof textarea.selectionStart === "number"
        ? textarea.selectionStart
        : 0;
    const upToIndex = value.slice(0, index);
    const fenceMatches = upToIndex.match(/```/g);
    const insideFence = !!(fenceMatches && fenceMatches.length % 2 === 1);
    let insideInline = false;
    if (!insideFence) {
      const lastBacktick = upToIndex.lastIndexOf("`");
      if (lastBacktick !== -1) {
        const nextBacktick = value.indexOf("`", lastBacktick + 1);
        if (nextBacktick !== -1 && nextBacktick >= index) {
          const segment = value.slice(lastBacktick, nextBacktick + 1);
          if (!segment.includes("\n")) {
            insideInline = true;
          }
        }
      }
    }
    return {
      insideInline,
      insideFence,
      inside: insideInline || insideFence,
    };
  }

  function getEffectiveSettings() {
    if (savedSettings && typeof savedSettings === "object") {
      return savedSettings;
    }
    return getDefaultSettings();
  }

  function getTabStringFromSettings() {
    const settings = getEffectiveSettings();
    let length = Number(settings && settings.tabLength);
    if (!Number.isFinite(length) || length <= 0) {
      length = 2;
    }
    return " ".repeat(length);
  }

  function shouldShowGitignoreActions() {
    const settings = savedSettings || getDefaultSettings();
    if (!settings || typeof settings !== "object") {
      return false;
    }
    return !!settings.autoCommitNotes;
  }

  function formatDateTimeWithPattern(date, pattern) {
    if (!date || !pattern) {
      return "";
    }
    let result = String(pattern);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    function pad2(value) {
      return value < 10 ? "0" + value : String(value);
    }

    result = result.replace(/YYYY/g, String(year));
    result = result.replace(/MM/g, pad2(month));
    result = result.replace(/DD/g, pad2(day));
    result = result.replace(/HH/g, pad2(hours));
    result = result.replace(/mm/g, pad2(minutes));
    result = result.replace(/ss/g, pad2(seconds));

    return result;
  }

  function formatCurrentDateFromSettings() {
    const settings = getEffectiveSettings();
    const raw =
      (settings && typeof settings.dateFormat === "string"
        ? settings.dateFormat
        : "") || "";
    const pattern = raw.trim() || "YYYY-MM-DD";
    return formatDateTimeWithPattern(new Date(), pattern);
  }

  function formatCurrentTimeFromSettings() {
    const settings = getEffectiveSettings();
    const raw =
      (settings && typeof settings.timeFormat === "string"
        ? settings.timeFormat
        : "") || "";
    const pattern = raw.trim() || "HH:mm";
    return formatDateTimeWithPattern(new Date(), pattern);
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
  const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

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
      autoSaveIntervalSeconds: 60,
      tabLength: 2,
      indexPageTitle: "NoteBooks",
      dateFormat: "YYYY-MM-DD",
      timeFormat: "HH:mm",
      imageStoragePath: "images",
      imageMaxPasteBytes: 5 * 1024 * 1024,
      imageDisplayMode: "fit-width",
      imageMaxDisplayWidth: 0,
      imageMaxDisplayHeight: 0,
      imageDefaultAlignment: "left",
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
    applyImageDisplaySettingsInViewer(settings);
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
    const autoSaveDraft = Number(draftSettings.autoSaveIntervalSeconds || 0);
    const autoSaveSaved = Number(savedSettings.autoSaveIntervalSeconds || 0);
    const autoSaveDirty = autoSaveDraft !== autoSaveSaved;
    const tabDraft = Number(draftSettings.tabLength || 0);
    const tabSaved = Number(savedSettings.tabLength || 0);
    const tabDirty = tabDraft !== tabSaved;
    const dateFormatDraft = (draftSettings.dateFormat || "").trim();
    const dateFormatSaved = (savedSettings.dateFormat || "").trim();
    const dateFormatDirty = dateFormatDraft !== dateFormatSaved;
    const timeFormatDraft = (draftSettings.timeFormat || "").trim();
    const timeFormatSaved = (savedSettings.timeFormat || "").trim();
    const timeFormatDirty = timeFormatDraft !== timeFormatSaved;
    const imagePathDraft = (draftSettings.imageStoragePath || "").trim();
    const imagePathSaved = (savedSettings.imageStoragePath || "").trim();
    const imagePathDirty = imagePathDraft !== imagePathSaved;
    const maxDraft = Number(draftSettings.imageMaxPasteBytes || 0);
    const maxSaved = Number(savedSettings.imageMaxPasteBytes || 0);
    const imageMaxDirty = maxDraft !== maxSaved;
    const anyDirty =
      spellcheckDirty ||
      titleDirty ||
      autoSaveDirty ||
      tabDirty ||
      dateFormatDirty ||
      timeFormatDirty ||
      imagePathDirty ||
      imageMaxDirty;
    setSettingsCategoryDirty("general", anyDirty);
  }

  function updateFileHandlingCategoryDirty() {
    if (!savedSettings || !draftSettings) {
      return;
    }
    const modeDraft = (draftSettings.imageDisplayMode || "fit-width").trim();
    const modeSaved = (savedSettings.imageDisplayMode || "fit-width").trim();
    const maxWidthDraft = Number(draftSettings.imageMaxDisplayWidth || 0);
    const maxWidthSaved = Number(savedSettings.imageMaxDisplayWidth || 0);
    const maxHeightDraft = Number(draftSettings.imageMaxDisplayHeight || 0);
    const maxHeightSaved = Number(savedSettings.imageMaxDisplayHeight || 0);
    const alignDraft = (draftSettings.imageDefaultAlignment || "left").trim();
    const alignSaved = (savedSettings.imageDefaultAlignment || "left").trim();

    const dirty =
      modeDraft !== modeSaved ||
      maxWidthDraft !== maxWidthSaved ||
      maxHeightDraft !== maxHeightSaved ||
      alignDraft !== alignSaved;
    setSettingsCategoryDirty("file-handling", dirty);
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
    if (settingsDateFormatInput) {
      const value = draftSettings.dateFormat || "YYYY-MM-DD";
      settingsDateFormatInput.value = value;
    }
    if (settingsTimeFormatInput) {
      const value = draftSettings.timeFormat || "HH:mm";
      settingsTimeFormatInput.value = value;
    }
    if (settingsAutoSaveIntervalInput) {
      const seconds = Number(draftSettings.autoSaveIntervalSeconds || 0);
      settingsAutoSaveIntervalInput.value =
        seconds > 0 ? String(seconds) : "";
    }
    if (settingsTabLengthInput) {
      const length = Number(draftSettings.tabLength || 0);
      settingsTabLengthInput.value = length > 0 ? String(length) : "";
    }
    if (settingsImageDisplayModeSelect) {
      const mode = draftSettings.imageDisplayMode || "fit-width";
      settingsImageDisplayModeSelect.value = mode;
    }
    if (settingsImageMaxWidthInput) {
      const width = Number(draftSettings.imageMaxDisplayWidth || 0);
      settingsImageMaxWidthInput.value = width > 0 ? String(width) : "";
    }
    if (settingsImageMaxHeightInput) {
      const height = Number(draftSettings.imageMaxDisplayHeight || 0);
      settingsImageMaxHeightInput.value = height > 0 ? String(height) : "";
    }
    if (settingsImageDefaultAlignmentSelect) {
      const align = draftSettings.imageDefaultAlignment || "left";
      settingsImageDefaultAlignmentSelect.value = align;
    }
    if (settingsImagesStoragePathInput) {
      settingsImagesStoragePathInput.value =
        draftSettings.imageStoragePath || "images";
    }
    if (settingsImagesMaxSizeMbInput) {
      const bytes = Number(draftSettings.imageMaxPasteBytes || 0);
      settingsImagesMaxSizeMbInput.value =
        bytes > 0 ? String(Math.round(bytes / (1024 * 1024))) : "";
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
    settingsDateFormatInput = root.querySelector("#settings-date-format");
    settingsTimeFormatInput = root.querySelector("#settings-time-format");
    settingsTabLengthInput = root.querySelector("#settings-tab-length");
    settingsAutoSaveIntervalInput = root.querySelector(
      "#settings-auto-save-interval"
    );
    settingsImageDisplayModeSelect = root.querySelector(
      "#settings-image-display-mode"
    );
    settingsImageMaxWidthInput = root.querySelector(
      "#settings-image-max-width"
    );
    settingsImageMaxHeightInput = root.querySelector(
      "#settings-image-max-height"
    );
    settingsImageDefaultAlignmentSelect = root.querySelector(
      "#settings-image-default-alignment"
    );
    settingsImagesStoragePathInput = root.querySelector(
      "#settings-image-storage-path"
    );
    settingsImagesMaxSizeMbInput = root.querySelector(
      "#settings-image-max-size-mb"
    );
    settingsImagesCleanupBtn = root.querySelector(
      "#settings-images-cleanup-btn"
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

    if (settingsDateFormatInput) {
      settingsDateFormatInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const value = settingsDateFormatInput.value || "";
        draftSettings.dateFormat = value.trim();
        updateGeneralCategoryDirty();
      });
    }

    if (settingsTimeFormatInput) {
      settingsTimeFormatInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const value = settingsTimeFormatInput.value || "";
        draftSettings.timeFormat = value.trim();
        updateGeneralCategoryDirty();
      });
    }

    if (settingsTabLengthInput) {
      settingsTabLengthInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const raw = settingsTabLengthInput.value;
        let length = parseInt(raw, 10);
        if (!Number.isFinite(length) || length <= 0) {
          length = 2;
        }
        draftSettings.tabLength = length;
        updateGeneralCategoryDirty();
      });
    }

    if (settingsAutoSaveIntervalInput) {
      settingsAutoSaveIntervalInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const raw = settingsAutoSaveIntervalInput.value;
        let seconds = parseInt(raw, 10);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          seconds = 0;
        }
        draftSettings.autoSaveIntervalSeconds = seconds;
        updateGeneralCategoryDirty();
      });
    }

    if (settingsImageDisplayModeSelect) {
      settingsImageDisplayModeSelect.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const value = settingsImageDisplayModeSelect.value || "fit-width";
        draftSettings.imageDisplayMode = value;
        updateFileHandlingCategoryDirty();
      });
    }

    if (settingsImageMaxWidthInput) {
      settingsImageMaxWidthInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const raw = settingsImageMaxWidthInput.value;
        let px = parseInt(raw, 10);
        if (!Number.isFinite(px) || px <= 0) {
          px = 0;
        }
        draftSettings.imageMaxDisplayWidth = px;
        updateFileHandlingCategoryDirty();
      });
    }

    if (settingsImageMaxHeightInput) {
      settingsImageMaxHeightInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const raw = settingsImageMaxHeightInput.value;
        let px = parseInt(raw, 10);
        if (!Number.isFinite(px) || px <= 0) {
          px = 0;
        }
        draftSettings.imageMaxDisplayHeight = px;
        updateFileHandlingCategoryDirty();
      });
    }

    if (settingsImageDefaultAlignmentSelect) {
      settingsImageDefaultAlignmentSelect.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const value =
          settingsImageDefaultAlignmentSelect.value || "left";
        draftSettings.imageDefaultAlignment = value;
        updateFileHandlingCategoryDirty();
      });
    }

    if (settingsImagesStoragePathInput) {
      settingsImagesStoragePathInput.addEventListener("input", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const value = settingsImagesStoragePathInput.value || "";
        draftSettings.imageStoragePath = value.trim();
        updateGeneralCategoryDirty();
      });
    }

    if (settingsImagesMaxSizeMbInput) {
      settingsImagesMaxSizeMbInput.addEventListener("change", () => {
        if (!draftSettings) {
          draftSettings = savedSettings
            ? { ...savedSettings }
            : getDefaultSettings();
        }
        const raw = settingsImagesMaxSizeMbInput.value;
        let mb = parseInt(raw, 10);
        if (!Number.isFinite(mb) || mb <= 0) {
          draftSettings.imageMaxPasteBytes = 0;
        } else {
          draftSettings.imageMaxPasteBytes = mb * 1024 * 1024;
        }
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

    if (settingsImagesCleanupBtn) {
      settingsImagesCleanupBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await runImageCleanup();
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
      await saveCurrentNoteIfEditing();
      updateAutoSaveTimerFromSettings();
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
    updateFileHandlingCategoryDirty();
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

  async function runImageCleanup() {
    try {
      clearError();
      const result = await fetchJSON("/api/images/cleanup", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const total = typeof result.total === "number" ? result.total : 0;
      const deleted = Array.isArray(result.deleted)
        ? result.deleted.length
        : 0;
      showError(
        `Image cleanup completed: deleted ${deleted} of ${total} file(s).`
      );
    } catch (err) {
      showError(`Failed to cleanup images: ${err.message}`);
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
      const textEl = navFooterBuildEl.querySelector("#build-tag-text");
      if (textEl) {
        if (tag && build !== null) {
          textEl.textContent = `${tag}.${build}`;
        } else if (tag) {
          textEl.textContent = tag;
        } else if (build !== null) {
          textEl.textContent = `Build ${build}`;
        } else {
          textEl.textContent = "";
        }
      }
    } catch (err) {
      const textEl = navFooterBuildEl.querySelector("#build-tag-text");
      if (textEl) {
        textEl.textContent = "";
      }
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

  function updateAutoSaveTimerFromSettings() {
    if (notesAutoSaveTimerId !== null) {
      window.clearInterval(notesAutoSaveTimerId);
      notesAutoSaveTimerId = null;
    }
    const settings = savedSettings || getDefaultSettings();
    const seconds = Number(settings.autoSaveIntervalSeconds || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }
    const intervalMs = seconds * 1000;
    notesAutoSaveTimerId = window.setInterval(() => {
      if (!currentNote || mode !== "edit") {
        return;
      }
      autoSaveCurrentNote();
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
          await openNotePath(path);
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
        id: "expand-folder-all",
        label: "Expand all in folder",
      });
      items.push({
        id: "collapse-folder-all",
        label: "Collapse all in folder",
      });
      items.push({ id: "expand-all", label: "Expand all" });
      items.push({ id: "collapse-all", label: "Collapse all" });
      if (shouldShowGitignoreActions() && target.path) {
        items.push({ separator: true });
        items.push({
          id: "gitignore-add",
          label: "Add to notes .gitignore",
        });
        items.push({
          id: "gitignore-remove",
          label: "Remove from notes .gitignore",
        });
      }
      items.push({ separator: true });
      items.push({
        id: "copy-path",
        label: isRoot ? "Copy notebook root path" : "Copy folder path",
      });
    } else if (target.type === "note") {
      items.push({ id: "open-note", label: "Open note" });
      items.push({ id: "edit-note", label: "Edit note" });
      items.push({ id: "export-note", label: "Export note" });
      items.push({ id: "rename", label: "Rename note" });
      items.push({ id: "delete", label: "Delete note" });
      items.push({ separator: true });
      items.push({ id: "expand-all", label: "Expand all" });
      items.push({ id: "collapse-all", label: "Collapse all" });
      if (shouldShowGitignoreActions() && target.path) {
        items.push({ separator: true });
        items.push({
          id: "gitignore-add",
          label: "Add to notes .gitignore",
        });
        items.push({
          id: "gitignore-remove",
          label: "Remove from notes .gitignore",
        });
      }
      items.push({ separator: true });
      items.push({ id: "copy-path", label: "Copy note path" });
    } else if (target.type === "image") {
      items.push({ id: "open-image", label: "Open image" });
      items.push({ separator: true });
      items.push({ id: "expand-all", label: "Expand all" });
      items.push({ id: "collapse-all", label: "Collapse all" });
      if (shouldShowGitignoreActions() && target.path) {
        items.push({ separator: true });
        items.push({
          id: "gitignore-add",
          label: "Add to notes .gitignore",
        });
        items.push({
          id: "gitignore-remove",
          label: "Remove from notes .gitignore",
        });
      }
      items.push({ separator: true });
      items.push({ id: "copy-path", label: "Copy image path" });
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

    let type = "note";
    if (item.classList.contains("folder")) {
      type = "folder";
    } else if (item.classList.contains("image")) {
      type = "image";
    }
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

    if (actionId === "expand-all") {
      expandAllFolders();
      return;
    }

    if (actionId === "collapse-all") {
      collapseAllFolders();
      return;
    }

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

    if (actionId === "gitignore-add") {
      if (!path) {
        return;
      }
      try {
        clearError();
        await fetchJSON("/api/versioning/notes/gitignore/add", {
          method: "POST",
          body: JSON.stringify({ path }),
        });
        await triggerNotesAutoCommit();
      } catch (err) {
        showError(`Failed to update notes .gitignore: ${err.message}`);
      }
      return;
    }

    if (actionId === "gitignore-remove") {
      if (!path) {
        return;
      }
      try {
        clearError();
        await fetchJSON("/api/versioning/notes/gitignore/remove", {
          method: "POST",
          body: JSON.stringify({ path }),
        });
        await triggerNotesAutoCommit();
      } catch (err) {
        showError(`Failed to update notes .gitignore: ${err.message}`);
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
      } else if (actionId === "expand-folder-all") {
        if (targetEl && targetEl.classList.contains("folder")) {
          expandAllInFolder(targetEl);
        }
      } else if (actionId === "collapse-folder-all") {
        if (targetEl && targetEl.classList.contains("folder")) {
          collapseAllInFolder(targetEl);
        }
      } else if (actionId === "expand-all") {
        expandAllFolders();
      } else if (actionId === "collapse-all") {
        collapseAllFolders();
      }
      return;
    }

    if (type === "image") {
      if (actionId === "open-image" && path) {
        if (targetEl) {
          clearSelection();
          targetEl.classList.add("selected");
        }
        await openImagePath(path);
      }
      return;
    }

    if (type === "note") {
      if (actionId === "open-note" && path) {
        if (targetEl) {
          clearSelection();
          targetEl.classList.add("selected");
        }
        await openNotePath(path);
      } else if (actionId === "edit-note" && path) {
        if (targetEl) {
          clearSelection();
          targetEl.classList.add("selected");
        }
        await openNotePath(path);
        setMode("edit");
      } else if (actionId === "export-note" && path) {
        if (targetEl) {
          clearSelection();
          targetEl.classList.add("selected");
        }
        await openNotePath(path);
        await downloadCurrentNoteHtml();
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
      return;
    }

    if (mode === "view") {
      const percent = getScrollPercent(editorEl);

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

      setScrollPercent(viewerEl, percent);
    } else {
      const percent = getScrollPercent(viewerEl);

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
      editorEl.focus();

      setScrollPercent(editorEl, percent);
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

  function setFolderExpanded(folderItem, expanded) {
    if (!folderItem) return;
    const childrenContainer = folderItem.nextElementSibling;
    if (
      !childrenContainer ||
      !childrenContainer.classList.contains("tree-children")
    ) {
      return;
    }
    if (expanded) {
      folderItem.classList.add("expanded");
      childrenContainer.style.display = "block";
    } else {
      childrenContainer.style.display = "none";
      folderItem.classList.remove("expanded");
    }
  }

  function restoreExpandedFolders() {
    if (!treeContainer || !expandedFolderPaths || expandedFolderPaths.size === 0) {
      return;
    }
    const items = treeContainer.querySelectorAll(".tree-item.folder");
    items.forEach((item) => {
      const path = item.dataset.path;
      if (typeof path === "string" && expandedFolderPaths.has(path)) {
        setFolderExpanded(item, true);
      }
    });
  }

  function expandAllInFolder(folderItem) {
    if (!folderItem || !treeContainer) return;
    const baseContainer = folderItem.nextElementSibling;
    if (
      !baseContainer ||
      !baseContainer.classList.contains("tree-children")
    ) {
      return;
    }
    setFolderExpanded(folderItem, true);
    const folders = baseContainer.querySelectorAll(".tree-item.folder");
    folders.forEach((el) => {
      setFolderExpanded(el, true);
    });
  }

  function collapseAllInFolder(folderItem) {
    if (!folderItem || !treeContainer) return;
    const baseContainer = folderItem.nextElementSibling;
    if (
      !baseContainer ||
      !baseContainer.classList.contains("tree-children")
    ) {
      return;
    }
    const folders = baseContainer.querySelectorAll(".tree-item.folder");
    folders.forEach((el) => {
      setFolderExpanded(el, false);
    });
    setFolderExpanded(folderItem, false);
  }

  function expandAllFolders() {
    if (!treeContainer) return;
    const folders = treeContainer.querySelectorAll(".tree-item.folder");
    folders.forEach((item) => {
      setFolderExpanded(item, true);
    });
  }

  function collapseAllFolders() {
    if (!treeContainer) return;
    const folders = treeContainer.querySelectorAll(".tree-item.folder");
    folders.forEach((item) => {
      setFolderExpanded(item, false);
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
          openNotePath(lastPath);
          break;
        }
      }
    } catch (e) {
      // Ignore storage errors
    }
  }
  function normalizeSharedNotePath(raw) {
    if (!raw) return "";
    let value = String(raw).trim();
    if (!value) return "";
    if (value.startsWith("?")) {
      value = value.slice(1);
    }
    const qIndex = value.indexOf("?");
    if (qIndex !== -1) {
      value = value.slice(0, qIndex);
    }
    while (value.startsWith("/")) {
      value = value.slice(1);
    }
    const lower = value.toLowerCase();
    if (lower.startsWith("notes/")) {
      value = value.slice("notes/".length);
    }
    return value;
  }

  function normalizeSharedMode(raw) {
    if (!raw) return "";
    const value = String(raw).trim().toLowerCase();
    if (!value) return "";
    if (value === "view") return "read";
    if (value === "reader") return "read";
    if (value === "editor") return "edit";
    if (value === "html") return "export";
    if (value === "dl") return "download";
    if (value === "read" || value === "edit" || value === "export" || value === "download") {
      return value;
    }
    return "";
  }

  async function handleSharedLinkFromLocation() {
    if (typeof window === "undefined" || !window.location) {
      return;
    }
    const search = window.location.search || "";
    if (!search || search.length <= 1) {
      return;
    }

    let params;
    try {
      params = new URLSearchParams(search);
    } catch (e) {
      return;
    }

    let rawNote = params.get("note") || "";
    let rawMode = params.get("mode") || "";

    if (!rawMode && rawNote && rawNote.indexOf("?") !== -1) {
      const parts = rawNote.split("?", 2);
      rawNote = parts[0];
      try {
        const inner = new URLSearchParams(parts[1] || "");
        rawMode = inner.get("mode") || rawMode;
      } catch (e) {}
    }

    const notePath = normalizeSharedNotePath(rawNote);
    const modeFromUrl = normalizeSharedMode(rawMode);

    if (!notePath) {
      return;
    }

    try {
      const items = document.querySelectorAll(".tree-item.note");
      for (const el of items) {
        if (el.dataset.path === notePath) {
          clearSelection();
          el.classList.add("selected");
          break;
        }
      }
    } catch (e) {}

    if (isImagePath(notePath)) {
      await openImagePath(notePath);
      if (modeFromUrl === "download") {
        try {
          const link = document.createElement("a");
          link.href = `/files/${notePath}`;
          const name = notePath.split("/").pop() || notePath;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          link.remove();
        } catch (e) {}
      }
      return;
    }

    await openNotePath(notePath);

    if (!modeFromUrl) {
      return;
    }

    if (modeFromUrl === "read") {
      setMode("view");
      return;
    }

    if (modeFromUrl === "edit") {
      setMode("edit");
      return;
    }

    if (modeFromUrl === "export") {
      if (currentNote && currentNote.path === notePath) {
        await downloadCurrentNoteHtml();
      }
      return;
    }

    if (modeFromUrl === "download") {
      if (currentNote && currentNote.path === notePath) {
        try {
          const blob = new Blob([currentNote.content || ""], {
            type: "text/markdown;charset=utf-8",
          });
          const blobUrl = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          const baseName = currentNote.name || notePath.split("/").pop() || "note.md";
          const name = /\.md$/i.test(baseName) ? baseName : `${baseName}.md`;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(blobUrl);
        } catch (e) {}
      }
    }
  }

  function buildSharedUrlFromState(notePath, logicalMode) {
    if (typeof window === "undefined" || !window.location) {
      return "";
    }
    const origin = window.location.origin || "";
    const basePath = window.location.pathname || "/";
    const params = new URLSearchParams();
    if (notePath) {
      params.set("note", "/notes/" + notePath);
    }
    let modeParam = "";
    if (logicalMode === "edit") {
      modeParam = "edit";
    } else if (logicalMode === "view") {
      modeParam = "read";
    }
    if (modeParam) {
      params.set("mode", modeParam);
    }
    const query = params.toString();
    const baseUrl = origin + basePath;
    if (!query) {
      return baseUrl;
    }
    return baseUrl + "?" + query;
  }

  function syncLocationToCurrentState() {
    if (
      typeof window === "undefined" ||
      !window.location ||
      !window.history ||
      typeof window.history.replaceState !== "function"
    ) {
      return;
    }
    let notePath = "";
    if (currentNote && currentNote.path) {
      notePath = currentNote.path;
    } else if (currentImage && currentImage.path) {
      notePath = currentImage.path;
    }
    const url = buildSharedUrlFromState(notePath, mode);
    if (!url || window.location.href === url) {
      return;
    }
    window.history.replaceState(null, "", url);
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
        const expanded = item.classList.contains("expanded");
        setFolderExpanded(item, !expanded);
      });

      container.appendChild(item);
      container.appendChild(childrenContainer);

      if (Array.isArray(node.children)) {
        node.children.forEach((child) => {
          renderNode(child, childrenContainer, depth + 1);
        });
      }
    } else if (node.type === "image") {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        clearSelection();
        item.classList.add("selected");
        await openImagePath(node.path);
      });
      container.appendChild(item);
    } else {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        clearSelection();
        item.classList.add("selected");
        await openNotePath(node.path);
      });
      container.appendChild(item);
    }
  }

  function isImagePath(path) {
    if (!path) return false;
    const lower = String(path).toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  async function openImagePath(path) {
    const nextPath = (path || "").trim();
    if (!nextPath) {
      return;
    }

    await saveCurrentNoteIfEditing();

    currentNote = null;
    currentImage = {
      path: nextPath,
      name: nextPath.split("/").pop() || nextPath,
    };

    noteNameEl.textContent = currentImage.name;
    notePathEl.textContent = currentImage.path;

    mode = "view";
    viewerEl.classList.remove("hidden");
    if (editorWrapperEl) {
      editorWrapperEl.classList.add("hidden");
    } else {
      editorEl.classList.add("hidden");
    }

    modeToggleBtn.disabled = true;
    if (noteExportBtn) {
      noteExportBtn.disabled = true;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "image-viewer";
    const img = document.createElement("img");
    img.src = `/files/${currentImage.path}`;
    img.alt = currentImage.name;
    wrapper.appendChild(img);

    viewerEl.innerHTML = "";
    viewerEl.appendChild(wrapper);

    applyImageDisplaySettingsInViewer();
  }

  async function openNotePath(path) {
    const nextPath = (path || "").trim();
    if (!nextPath) {
      return;
    }
    if (currentNote && currentNote.path === nextPath) {
      return;
    }
    await saveCurrentNoteIfEditing();
    await loadNote(nextPath);
  }

  async function loadNote(path) {
    try {
      clearError();
      const note = await fetchJSON(`/api/notes/${encodeURIComponent(path)}`);
      currentNote = note;
      currentImage = null;
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
      applyImageDisplaySettingsInViewer();
      renderMermaidInViewer();
      editorEl.value = note.content || "";
      if (
        window.markdownEditorHighlighter &&
        typeof window.markdownEditorHighlighter.refresh === "function"
      ) {
        window.markdownEditorHighlighter.refresh();
      }
      updateEditorLineNumbers();
      modeToggleBtn.disabled = false;
      if (noteExportBtn) {
        noteExportBtn.disabled = false;
      }
      setMode("view");
    } catch (err) {
      viewerEl.textContent = "Failed to load note.";
      editorEl.value = "";
      if (
        window.markdownEditorHighlighter &&
        typeof window.markdownEditorHighlighter.refresh === "function"
      ) {
        window.markdownEditorHighlighter.refresh();
      }
      updateEditorLineNumbers();
      currentNote = null;
      modeToggleBtn.disabled = true;
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
      currentNote.content = updatedContent;
      // Reload to update rendered HTML and reset to view mode
      await loadNote(currentNote.path);
      await triggerNotesAutoCommit();
    } catch (err) {
      showError(`Failed to save note: ${err.message}`);
    }
  }

  async function autoSaveCurrentNote() {
    if (!currentNote) return;
    try {
      const updatedContent = editorEl.value;
      await fetchJSON(`/api/notes/${encodeURIComponent(currentNote.path)}`, {
        method: "PUT",
        body: JSON.stringify({ content: updatedContent }),
      });
      currentNote.content = updatedContent;
      await triggerNotesAutoCommit();
    } catch (err) {
      showError(`Failed to auto-save note: ${err.message}`);
    }
  }

  async function saveCurrentNoteIfEditing() {
    if (!currentNote) return;
    if (mode !== "edit") return;
    await saveCurrentNote();
  }

  async function uploadImageFileForNote(notePath, file) {
    if (!file) return null;
    const formData = new FormData();
    formData.append("note_path", notePath || "");
    formData.append("file", file);
    const res = await fetch("/api/images/paste", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async function handleEditorPaste(e) {
    if (!editorEl) return;
    const dt = e.clipboardData;
    if (!dt || !dt.items || !dt.items.length) {
      return;
    }

    const imageFiles = [];
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (!item) continue;
      if (item.kind === "file" && item.type && item.type.indexOf("image/") === 0) {
        const file = item.getAsFile && item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (!imageFiles.length) {
      return;
    }

    if (!currentNote || !currentNote.path) {
      showError("Paste images is only available when a note is selected.");
      e.preventDefault();
      return;
    }

    e.preventDefault();

    const settings = savedSettings || getDefaultSettings();
    const maxBytes = Number(settings.imageMaxPasteBytes || 0);

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      if (!file) continue;
      const size = typeof file.size === "number" ? file.size : 0;

      if (maxBytes > 0 && size > maxBytes) {
        const sizeMb = size / (1024 * 1024);
        const limitMb = maxBytes / (1024 * 1024);
        const message =
          `Image is ${sizeMb.toFixed(2)} MB, limit is ${limitMb.toFixed(
            2
          )} MB. Paste anyway?`;
        const proceed = window.confirm(message);
        if (!proceed) {
          continue;
        }
      }

      try {
        const result = await uploadImageFileForNote(currentNote.path, file);
        if (result && result.markdown) {
          const text = String(result.markdown || "") + "\n";
          insertTextAtCursor(editorEl, text);
        }
      } catch (err) {
        showError(`Failed to upload image: ${err.message}`);
      }
    }

    updateEditorLineNumbers();
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
      await saveCurrentNoteIfEditing();
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
          await openNotePath(path);
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
      await saveCurrentNoteIfEditing();
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
      await saveCurrentNoteIfEditing();
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

    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (
      isCtrlOrMeta &&
      e.shiftKey &&
      !e.altKey &&
      (e.key === "E" || e.key === "e")
    ) {
      if (!currentNote || !modeToggleBtn || modeToggleBtn.disabled) {
        return;
      }
      e.preventDefault();
      modeToggleBtn.click();
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
    const isImage = current.classList.contains("image");

    if (e.key === "ArrowRight") {
      if (isFolder) {
        const expanded = current.classList.contains("expanded");
        if (!expanded) {
          setFolderExpanded(current, true);
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
        setFolderExpanded(current, false);
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
        const expanded = current.classList.contains("expanded");
        setFolderExpanded(current, !expanded);
      } else if (isNote || isImage) {
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
  modeToggleBtn.addEventListener("click", async () => {
    if (!currentNote) return;
    if (mode === "edit") {
      await saveCurrentNote();
      return;
    }
    setMode("edit");
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
    editorEl.addEventListener("paste", (e) => {
      handleEditorPaste(e);
    });
    editorEl.addEventListener("keydown", (e) => {
      const key = e.key;
      const code = e.code || "";
      const isTab = key === "Tab";
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;

      function refreshEditorAfterShortcut() {
        updateEditorLineNumbers();
        if (
          window.markdownEditorHighlighter &&
          typeof window.markdownEditorHighlighter.refresh === "function"
        ) {
          window.markdownEditorHighlighter.refresh();
        }
      }

      if (isTab) {
        e.preventDefault();
        const tabString = getTabStringFromSettings();
        if (e.shiftKey) {
          unindentSelectedLines(editorEl, tabString);
        } else {
          indentSelectedLines(editorEl, tabString);
        }
        refreshEditorAfterShortcut();
        return;
      }

      if (isAlt && e.shiftKey && (key === "F" || key === "f")) {
        e.preventDefault();
        return;
      }

      if (!isCtrlOrMeta) {
        return;
      }

      const codeState = getEditorCodeState(editorEl);
      const lowerKey = (key || "").toLowerCase();
      const isSaveCombo = !isAlt && !e.shiftKey && lowerKey === "s";
      const isIndentCombo = e.shiftKey && (key === ">" || key === "<");
      const isDuplicateCombo = e.shiftKey && lowerKey === "d";

      if (codeState.inside && !isSaveCombo && !isIndentCombo && !isDuplicateCombo) {
        return;
      }

      if (isSaveCombo) {
        e.preventDefault();
        if (!currentNote) {
          return;
        }
        autoSaveCurrentNote();
        return;
      }

      if (!isAlt && !e.shiftKey && code === "Semicolon") {
        e.preventDefault();
        const formatted = formatCurrentDateFromSettings();
        if (!formatted) {
          return;
        }
        insertTextAtCursor(editorEl, formatted);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && e.shiftKey && code === "Semicolon") {
        e.preventDefault();
        const formatted = formatCurrentTimeFromSettings();
        if (!formatted) {
          return;
        }
        insertTextAtCursor(editorEl, formatted);
        refreshEditorAfterShortcut();
        return;
      }

      if (isIndentCombo) {
        e.preventDefault();
        const tabString = getTabStringFromSettings();
        if (key === ">") {
          indentSelectedLines(editorEl, tabString);
        } else {
          unindentSelectedLines(editorEl, tabString);
        }
        refreshEditorAfterShortcut();
        return;
      }

      if (isDuplicateCombo) {
        e.preventDefault();
        duplicateSelectedLines(editorEl);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && !e.shiftKey && lowerKey === "b") {
        e.preventDefault();
        wrapSelectionWithMarkers(editorEl, "**", "**");
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && !e.shiftKey && lowerKey === "i") {
        e.preventDefault();
        wrapSelectionWithMarkers(editorEl, "*", "*");
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && !e.shiftKey && lowerKey === "k") {
        e.preventDefault();
        insertLinkSelection(editorEl, false);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && e.shiftKey && lowerKey === "k") {
        e.preventDefault();
        toggleInlineCodeSelection(editorEl);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && e.shiftKey && lowerKey === "c") {
        e.preventDefault();
        toggleFenceBlockSelection(editorEl);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && e.shiftKey && lowerKey === "i") {
        e.preventDefault();
        insertLinkSelection(editorEl, true);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && !e.shiftKey && lowerKey === "h") {
        e.preventDefault();
        toggleHeadingLevel(editorEl);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && !e.shiftKey && lowerKey === "l") {
        e.preventDefault();
        toggleChecklistLines(editorEl);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && !e.shiftKey && lowerKey === "u") {
        e.preventDefault();
        toggleBulletLines(editorEl);
        refreshEditorAfterShortcut();
        return;
      }

      if (!isAlt && e.shiftKey && lowerKey === "o") {
        e.preventDefault();
        toggleOrderedLines(editorEl);
        refreshEditorAfterShortcut();
        return;
      }
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
    updateAutoSaveTimerFromSettings();
    setupSplitter();
    await loadTree();
    await handleSharedLinkFromLocation();
    await refreshAppVersionSubtitle();
  }

  initApp();
})();
