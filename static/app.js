let monacoEditor = null;
let monacoLoading = false;
let markdownRenderer = null;
let currentNotePath = null;
let currentNoteContent = "";
let currentMode = "view";
let treeInitialized = false;
let currentSearchHighlightIds = [];
let searchDebounceTimerId = null;
let latestSearchRequestId = 0;
let isSyncingScrollFromEditor = false;
let isSyncingScrollFromViewer = false;

const VALID_MODES = new Set(["view", "edit", "export", "download"]);
const DEFAULT_MODE = "view";
let desiredTreeSelectionPath = null;
const NOTE_MODE_ACTIONS = {
  export: handleNoteExport,
  download: handleNoteDownload,
};

function normalizeMode(mode) {
  if (!mode || typeof mode !== "string") {
    return DEFAULT_MODE;
  }

  const lower = mode.toLowerCase();
  return VALID_MODES.has(lower) ? lower : DEFAULT_MODE;
}

function encodeNoteParam(notePath) {
  if (!notePath) {
    return "";
  }

  const normalized = notePath.startsWith("/") ? notePath.slice(1) : notePath;

  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/${encoded}`;
}

function decodeNoteParam(rawValue) {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.startsWith("/") ? rawValue.slice(1) : rawValue;

  if (!trimmed) {
    return null;
  }

  return trimmed
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function getUrlState() {
  const params = new URLSearchParams(window.location.search);
  const noteParam = params.get("note");
  const modeParam = params.get("mode");

  return {
    note: decodeNoteParam(noteParam),
    mode: normalizeMode(modeParam || DEFAULT_MODE),
  };
}

function updateUrlState(notePath, mode, options = {}) {
  const { replace = false } = options;
  const url = new URL(window.location.href);
  const params = url.searchParams;

  if (notePath) {
    params.set("note", encodeNoteParam(notePath));
  } else {
    params.delete("note");
  }

  if (mode) {
    params.set("mode", normalizeMode(mode));
  } else {
    params.delete("mode");
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method](null, "", url);
}

function ensureMarkdownRenderer() {
  if (markdownRenderer || typeof window === "undefined") return markdownRenderer;

  if (typeof window.markdownit !== "function") {
    console.warn("markdown-it is not available; falling back to server-rendered HTML only.");
    return null;
  }

  markdownRenderer = window.markdownit({
    html: true,
    linkify: true,
    breaks: false,
  });

  return markdownRenderer;
}

function preprocessMermaidFences(text) {
  const lines = [];
  let inMermaid = false;
  let buffer = [];

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trimStart();

    if (!inMermaid && trimmed.startsWith("```mermaid")) {
      inMermaid = true;
      buffer = [];
      return;
    }

    if (inMermaid && trimmed.startsWith("```")) {
      inMermaid = false;
      const body = buffer.join("\n").replace(/^[\n]+|[\n]+$/g, "");
      lines.push(`<div class="mermaid">${body}</div>`);
      buffer = [];
      return;
    }

    if (inMermaid) {
      buffer.push(line);
    } else {
      lines.push(line);
    }
  });

  if (inMermaid && buffer.length) {
    lines.push(...buffer);
  }

  return lines.join("\n");
}

function renderViewerHtml(html) {
  const viewerEl = document.getElementById("viewer");
  if (!viewerEl) return;

  viewerEl.innerHTML = html;

  if (window.mermaid && typeof window.mermaid.init === "function") {
    try {
      window.mermaid.init(undefined, viewerEl.querySelectorAll(".mermaid"));
    } catch (error) {
      console.error("Mermaid rendering failed", error);
    }
  }
}

function clearCurrentNoteDisplay() {
  const viewerEl = document.getElementById("viewer");
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const exportBtn = document.getElementById("note-export-btn");
  const downloadBtn = document.getElementById("note-download-btn");

  if (viewerEl) {
    viewerEl.textContent = "Select a note to begin.";
  }

  if (noteNameEl) {
    noteNameEl.textContent = "No note selected";
  }

  if (notePathEl) {
    notePathEl.textContent = "";
  }

  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.onclick = null;
  }

  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.onclick = null;
  }

  currentNotePath = null;
  currentNoteContent = "";
  setMode(DEFAULT_MODE, { skipUrlUpdate: true });
  updateUrlState(null, DEFAULT_MODE, { replace: true });
}

function updatePreviewFromEditor() {
  if (!monacoEditor) return;

  const md = ensureMarkdownRenderer();
  if (!md) return;

  const value = monacoEditor.getValue();
  const processed = preprocessMermaidFences(value);
  const html = md.render(processed);
  renderViewerHtml(html);
}

function initMonacoEditor() {
  if (monacoEditor || monacoLoading) return;

  const editorContainer = document.getElementById("editor");
  if (!editorContainer) return;

  if (typeof require === "undefined") {
    console.error("Monaco loader (require) is not available. Ensure /vendor/monaco/vs/loader.js is served.");
    return;
  }

  require.config({ paths: { vs: "/vendor/monaco/vs" } });

  monacoLoading = true;
  require(["vs/editor/editor.main"], () => {
    monacoLoading = false;
    monacoEditor = monaco.editor.create(editorContainer, {
      value: "",
      language: "markdown",
      theme: "vs-dark",
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      wordWrap: "on",
      lineNumbers: "on",
    });

    if (currentNotePath) {
      monacoEditor.setValue(currentNoteContent || "");
      if (currentMode === "edit") {
        updatePreviewFromEditor();
      }
    }

    monacoEditor.onDidChangeModelContent(() => {
      currentNoteContent = monacoEditor.getValue();
      if (currentMode === "edit") {
        updatePreviewFromEditor();
      }
    });

    monacoEditor.onDidScrollChange(() => {
      const viewerEl = document.getElementById("viewer");
      if (!viewerEl) return;
      if (isSyncingScrollFromViewer) return;

      const scrollTop = monacoEditor.getScrollTop();
      const scrollHeight = monacoEditor.getScrollHeight();
      if (!scrollHeight) return;

      const ratio = scrollTop / scrollHeight;
      const viewerScrollable = viewerEl.scrollHeight - viewerEl.clientHeight;
      if (viewerScrollable > 0) {
        isSyncingScrollFromEditor = true;
        viewerEl.scrollTop = ratio * viewerScrollable;
        isSyncingScrollFromEditor = false;
      }
    });
  });
}

async function saveCurrentNote() {
  if (!monacoEditor || !currentNotePath) return;

  const content = monacoEditor.getValue();
  const safePath = toSafePath(currentNotePath);

  try {
    const response = await fetch(`/api/notes/${safePath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error(`Save note failed with status ${response.status}`);
    }
  } catch (error) {
    console.error("Save note request failed", error);
    showError("Unable to save note.");
    throw error;
  }
}

function setMode(mode, options = {}) {
  const { skipUrlUpdate = false, replaceUrl = false, triggerAction = false } = options;
  const normalizedMode = normalizeMode(mode);
  currentMode = normalizedMode;

  const viewerEl = document.getElementById("viewer");
  const editorWrapperEl = document.getElementById("editor-wrapper");
  const modeToggleBtn = document.getElementById("mode-toggle-btn");
  const exportBtn = document.getElementById("note-export-btn");
  const downloadBtn = document.getElementById("note-download-btn");

  if (!viewerEl || !editorWrapperEl || !modeToggleBtn || !exportBtn || !downloadBtn) {
    return;
  }

  if (!currentNotePath) {
    modeToggleBtn.disabled = true;
    editorWrapperEl.classList.add("hidden");
    exportBtn.disabled = true;
    exportBtn.onclick = null;
    downloadBtn.disabled = true;
    downloadBtn.onclick = null;
    return;
  }

  modeToggleBtn.disabled = false;
  exportBtn.disabled = false;
  downloadBtn.disabled = false;

  if (normalizedMode === "edit") {
    editorWrapperEl.classList.remove("hidden");
    modeToggleBtn.setAttribute("aria-label", "View");
    modeToggleBtn.setAttribute("title", "View");
    initMonacoEditor();

    if (monacoEditor) {
      monacoEditor.setValue(currentNoteContent || "");
      updatePreviewFromEditor();
    }
  } else {
    editorWrapperEl.classList.add("hidden");
    modeToggleBtn.setAttribute("aria-label", "Edit");
    modeToggleBtn.setAttribute("title", "Edit");
  }

  if (!skipUrlUpdate && currentNotePath) {
    updateUrlState(currentNotePath, normalizedMode, { replace: replaceUrl });
  }

  exportBtn.onclick = () => setMode("export", { triggerAction: true });
  downloadBtn.onclick = () => setMode("download", { triggerAction: true });

  if (triggerAction && (normalizedMode === "export" || normalizedMode === "download")) {
    void triggerNoteAction(normalizedMode);
  }
}

function triggerNoteAction(mode) {
  if (!currentNotePath) return;
  const action = NOTE_MODE_ACTIONS[mode];
  if (typeof action === "function") {
    return action();
  }
}

function handleNoteExport() {
  if (!currentNotePath) {
    showError("No note selected to export.");
    return;
  }

  const safePath = toSafePath(currentNotePath);
  window.open(`/api/export-note/${safePath}`, "_blank");
}

async function handleNoteDownload() {
  if (!currentNotePath) {
    showError("No note selected to download.");
    return;
  }

  const safePath = toSafePath(currentNotePath);

  try {
    const response = await fetch(`/api/notes/${safePath}`);

    if (!response.ok) {
      throw new Error(`Download request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data.content ?? "";
    const filename = data.name ?? currentNotePath.split("/").pop() ?? "note.md";

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Download note request failed", error);
    showError("Unable to download note.");
  }
}

function setupModeToggle() {
  const modeToggleBtn = document.getElementById("mode-toggle-btn");
  if (!modeToggleBtn) return;

  modeToggleBtn.addEventListener("click", async () => {
    if (!currentNotePath) return;

    if (currentMode === "view") {
      setMode("edit");
      return;
    }

    if (currentMode === "edit") {
      try {
        await saveCurrentNote();
        await loadNote(currentNotePath, { replaceUrl: true });
      } finally {
        setMode("view", { replaceUrl: true });
      }
      return;
    }

    setMode("view", { replaceUrl: true });
  });
}

async function updateHealthStatus() {
  const buildTagEl = document.getElementById("build-tag-text");

  if (!buildTagEl) return;

  buildTagEl.textContent = "Checking health…";

  try {
    const response = await fetch("/health");

    if (!response.ok) {
      throw new Error(`Health check failed with status ${response.status}`);
    }

    const data = await response.json();

    const statusText = data.status ?? "unknown";
    const versionText = data.version ? `v${data.version}` : "";

    buildTagEl.textContent = `${statusText} ${versionText}`.trim();
  } catch (error) {
    console.error("/health request failed", error);
    buildTagEl.textContent = "error";
    showError("Unable to reach backend health endpoint.");
  }
}

async function loadImage(imagePath) {
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const viewerEl = document.getElementById("viewer");

  if (!viewerEl || !noteNameEl || !notePathEl) return;

  viewerEl.textContent = "Loading image…";

  const safePath = toSafePath(imagePath);
  const img = new Image();
  img.src = `/files/${safePath}`;
  img.alt = imagePath;

  img.onload = () => {
    const parts = imagePath.split("/");
    const name = parts[parts.length - 1] || imagePath;
    noteNameEl.textContent = name;
    notePathEl.textContent = imagePath;
    viewerEl.innerHTML = "";
    viewerEl.appendChild(img);
  };

  img.onerror = () => {
    showError("Unable to load image from the server.");
    viewerEl.textContent = "Unable to load image.";
  };
}

function showError(message) {
  const banner = document.getElementById("error-banner");
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function toSafePath(relPath) {
  return relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getFancytreeInstance() {
  const treeRootEl = document.getElementById("tree");
  if (!treeRootEl || !window.jQuery || !treeInitialized) return null;

  const $ = window.jQuery;
  if (!$.ui || !$.ui.fancytree || typeof $.ui.fancytree.getTree !== "function") {
    return null;
  }

  try {
    return $.ui.fancytree.getTree(treeRootEl);
  } catch (error) {
    console.error("Fancytree getTree failed before initialization", error);
    return null;
  }
}

function selectTreeNodeByPath(path) {
  if (!path) return false;
  const tree = getFancytreeInstance();
  if (!tree) return false;

  const node = tree.getNodeByKey(path);
  if (!node) return false;

  node.makeVisible({ scrollIntoView: true, noAnimation: true });
  node.setFocus();
  node.setActive();
  return true;
}

function syncTreeSelection() {
  if (!desiredTreeSelectionPath) return;
  if (selectTreeNodeByPath(desiredTreeSelectionPath)) {
    desiredTreeSelectionPath = null;
  }
}

function ensureNoteTreeSelection(path) {
  if (!path) return;
  desiredTreeSelectionPath = path;
  syncTreeSelection();
}

function mapApiNodesToFancytree(nodes) {
  return nodes.map((node) => {
    const isFolder = node.type === "folder";
    const children = Array.isArray(node.children) ? node.children : [];

    return {
      title: node.name,
      key: node.path,
      folder: isFolder,
      extraClasses:
        node.type === "folder"
          ? "tree-node-folder"
          : node.type === "image"
          ? "tree-node-image"
          : "tree-node-note",
      data: {
        type: node.type,
        path: node.path,
      },
      children: isFolder ? mapApiNodesToFancytree(children) : undefined,
    };
  });
}

function setupNewItemButtons() {
  const newFolderBtn = document.getElementById("new-folder-btn");
  if (newFolderBtn) {
    newFolderBtn.addEventListener("click", () => {
      void handleNewFolderClick();
    });
  }

  const newNoteBtn = document.getElementById("new-note-btn");
  if (newNoteBtn) {
    newNoteBtn.addEventListener("click", () => {
      void handleNewNoteClick();
    });
  }
}

async function loadTree() {
  const treeRootEl = document.getElementById("tree");
  if (!treeRootEl) return;

  treeRootEl.textContent = "Loading tree…";

  try {
    const response = await fetch("/api/tree");

    if (!response.ok) {
      throw new Error(`Tree request failed with status ${response.status}`);
    }

    const data = await response.json();
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const source = mapApiNodesToFancytree(nodes);

    treeRootEl.textContent = "";

    if (!window.jQuery) {
      console.error("jQuery is not available; Fancytree cannot be initialized.");
      treeRootEl.textContent = "Unable to load notes tree.";
      showError("Unable to load notes tree from the server.");
      return;
    }

    const $tree = window.jQuery(treeRootEl);

    if (typeof $tree.fancytree !== "function") {
      console.error("Fancytree plugin is not available on the jQuery instance.");
      treeRootEl.textContent = "Unable to load notes tree.";
      showError("Unable to load notes tree from the server.");
      return;
    }

    if (!treeInitialized) {
      $tree.fancytree({
        extensions: ["persist", "edit"],
        source,
        autoScroll: true,
        clickFolderMode: 3,
        focusOnSelect: true,
        persist: {
          expandLazy: true,
          store: "local",
          types: "expanded",
        },
        edit: {
          triggerStart: [
            "clickActive",
            "dblclick",
            "f2",
            "mac+enter",
            "shift+click",
          ],
          beforeEdit: (_event, data) => {
            return canRenameTreeNode(data.node);
          },
          edit: (_event, data) => {
            prepareInlineRenameInput(data.node, data.input);
          },
          save: (_event, data) => {
            return handleInlineRenameSave(data.node, data.input);
          },
          close: (_event, data) => {
            if (!data.save) {
              return;
            }
            const node = data.node;
            const nodeType = node?.data?.type;
            const path = node?.data?.path;
            if (!path || !canRenameType(nodeType)) {
              return;
            }
            const finalName = data.input?.val() ?? "";
            const destinationPath = buildDestinationPath(path, finalName);
            if (destinationPath === path) {
              return;
            }
            void renameItem(path, destinationPath, nodeType);
          },
        },
        activate: (event, data) => {
          const node = data.node;
          if (!node || !node.data) return;

          const nodeType = node.data.type;
          const nodePath = node.data.path;

          if (!nodePath) return;

          if (nodeType === "note") {
            void loadNote(nodePath);
          } else if (nodeType === "image") {
            loadImage(nodePath);
          }
        },
        keydown: (event, data) => {
          if (event.key === "F2") {
            event.preventDefault();
            void handleRenameSelectedItem();
          } else if (event.key === "Delete") {
            event.preventDefault();
            void handleDeleteSelectedItem();
          }
        },
      });
      treeInitialized = true;
      syncTreeSelection();
    } else {
      const tree = getFancytreeInstance();
      if (tree) {
        await tree.reload(source);
        syncTreeSelection();
      }
    }
  } catch (error) {
    console.error("/api/tree request failed", error);
    treeRootEl.textContent = "Unable to load notes tree.";
    showError("Unable to load notes tree from the server.");
  }
}

async function loadNote(notePath, options = {}) {
  if (!notePath) return;

  const {
    skipUrlUpdate = false,
    replaceUrl = false,
    modeOverride = null,
    triggerAction = false,
  } = options;
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const viewerEl = document.getElementById("viewer");

  if (!viewerEl || !noteNameEl || !notePathEl) return;

  viewerEl.textContent = "Loading note…";

  clearSearchHighlights();

  try {
    const safePath = toSafePath(notePath);
    const response = await fetch(`/api/notes/${safePath}`);

    if (!response.ok) {
      throw new Error(`Note request failed with status ${response.status}`);
    }

    const data = await response.json();

    currentNotePath = data.path ?? notePath;
    currentNoteContent = data.content ?? "";
    noteNameEl.textContent = data.name ?? "";
    notePathEl.textContent = currentNotePath;

    renderViewerHtml(data.html ?? "");

    if (typeof modeOverride === "string") {
      currentMode = normalizeMode(modeOverride);
    }

    if (monacoEditor && currentMode === "edit") {
      monacoEditor.setValue(currentNoteContent);
      updatePreviewFromEditor();
    }

    setMode(currentMode, { skipUrlUpdate: true, triggerAction });

    ensureNoteTreeSelection(currentNotePath);

    if (!skipUrlUpdate) {
      updateUrlState(currentNotePath, currentMode, { replace: replaceUrl });
    }
  } catch (error) {
    console.error("/api/notes request failed", error);
    showError("Unable to load the selected note from the server.");
    viewerEl.textContent = "Unable to load note.";
  }
}

function clearSearchHighlights() {
  if (!monacoEditor) return;

  currentSearchHighlightIds = monacoEditor.deltaDecorations(
    currentSearchHighlightIds,
    [],
  );
}

function highlightSearchResultLine(lineNumber) {
  if (!monacoEditor || typeof monaco === "undefined") return;

  const model = monacoEditor.getModel();
  if (!model) return;

  const totalLines = model.getLineCount();
  if (!totalLines) return;

  const clamped = Math.max(1, Math.min(lineNumber, totalLines));
  const range = new monaco.Range(
    clamped,
    1,
    clamped,
    model.getLineMaxColumn(clamped),
  );

  currentSearchHighlightIds = monacoEditor.deltaDecorations(
    currentSearchHighlightIds,
    [
      {
        range,
        options: {
          isWholeLine: true,
          className: "search-line-highlight",
        },
      },
    ],
  );

  monacoEditor.revealLineInCenter(clamped);
}

function clearSearchUi() {
  const resultsEl = document.getElementById("search-results");
  if (!resultsEl) return;
  resultsEl.innerHTML = "";
  resultsEl.classList.add("hidden");
}

function updateSearchQueryInUrl(query) {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  if (query) {
    params.set("search", query);
  } else {
    params.delete("search");
  }

  window.history.replaceState(null, "", url);
}

function getInitialSearchQueryFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("search") || "";
}

function renderSearchResults(results, query) {
  const container = document.getElementById("search-results");
  if (!container) return;

  container.innerHTML = "";

  if (!query) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");

  const header = document.createElement("div");
  header.className = "search-results-header";

  const summary = document.createElement("span");
  const count = Array.isArray(results) ? results.length : 0;
  summary.textContent = count
    ? `${count} match${count === 1 ? "" : "es"}`
    : "No matches";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "small-btn";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => {
    const input = document.getElementById("search-input");
    if (input) {
      input.value = "";
    }
    clearSearchHighlights();
    clearSearchUi();
    updateSearchQueryInUrl("");
  });

  header.appendChild(summary);
  header.appendChild(clearBtn);
  container.appendChild(header);

  if (!count) {
    const empty = document.createElement("div");
    empty.className = "search-results-empty";
    empty.textContent = "No matches found.";
    container.appendChild(empty);
    return;
  }

  results.forEach((result) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result-item";

    const pathEl = document.createElement("div");
    pathEl.className = "search-result-path";
    pathEl.textContent = result.path || "";

    const snippetEl = document.createElement("div");
    snippetEl.className = "search-result-snippet";
    snippetEl.textContent = result.lineText || "";

    btn.appendChild(pathEl);
    btn.appendChild(snippetEl);

    btn.addEventListener("click", () => {
      void handleSearchResultClick(result);
    });

    container.appendChild(btn);
  });
}

async function performSearch(rawQuery) {
  const query = (rawQuery || "").trim();

  updateSearchQueryInUrl(query);

  if (!query) {
    clearSearchHighlights();
    clearSearchUi();
    return;
  }

  const requestId = ++latestSearchRequestId;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }

    const data = await response.json();
    if (requestId !== latestSearchRequestId) {
      return;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    renderSearchResults(results, query);
  } catch (error) {
    if (requestId !== latestSearchRequestId) {
      return;
    }

    console.error("/api/search request failed", error);
    showError("Unable to perform search.");
  }
}

async function handleSearchResultClick(result) {
  if (!result || !result.path || !result.lineNumber) return;

  const targetPath = result.path;
  const targetLine = Number(result.lineNumber) || 1;

  if (currentNotePath === targetPath) {
    setMode("edit", { replaceUrl: false });
    if (monacoEditor) {
      highlightSearchResultLine(targetLine);
    }
    return;
  }

  await loadNote(targetPath, {
    modeOverride: "edit",
    replaceUrl: false,
    triggerAction: false,
  });

  if (monacoEditor) {
    highlightSearchResultLine(targetLine);
  }
}

function setupSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;

  const initialQuery = getInitialSearchQueryFromUrl();
  if (initialQuery) {
    input.value = initialQuery;
    void performSearch(initialQuery);
  }

  input.addEventListener("input", () => {
    const value = input.value || "";

    if (searchDebounceTimerId !== null) {
      window.clearTimeout(searchDebounceTimerId);
    }

    searchDebounceTimerId = window.setTimeout(() => {
      searchDebounceTimerId = null;
      void performSearch(value);
    }, 250);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (searchDebounceTimerId !== null) {
        window.clearTimeout(searchDebounceTimerId);
        searchDebounceTimerId = null;
      }
      void performSearch(input.value || "");
    }
  });
}

function getBaseFolderPathForNewItem() {
  const tree = getFancytreeInstance();
  if (!tree) return "";

  const node = tree.getActiveNode();
  if (!node || !node.data) return "";

  const path = node.data.path || "";
  if (!path) return "";

  if (node.data.type === "folder") {
    return path;
  }

  const parts = path.split("/");
  if (parts.length <= 1) return "";
  parts.pop();
  return parts.join("/");
}

async function handleNewFolderClick() {
  const basePath = getBaseFolderPathForNewItem();
  const name = window.prompt("New folder name");
  if (!name) return;

  const trimmed = name.trim();
  if (!trimmed) return;

  const relPath = basePath ? `${basePath}/${trimmed}` : trimmed;

  try {
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath }),
    });

    if (!response.ok) {
      throw new Error(`Create folder failed with status ${response.status}`);
    }

    await loadTree();
  } catch (error) {
    console.error("/api/folders request failed", error);
    showError("Unable to create folder.");
  }
}

async function handleNewNoteClick() {
  const basePath = getBaseFolderPathForNewItem();
  const name = window.prompt("New note name (without extension)");
  if (!name) return;

  const trimmed = name.trim();
  if (!trimmed) return;

  const relPath = basePath ? `${basePath}/${trimmed}` : trimmed;

  try {
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath }),
    });

    if (!response.ok) {
      throw new Error(`Create note failed with status ${response.status}`);
    }

    const data = await response.json();
    const notePath = data.path || relPath;

    await loadTree();
    if (notePath) {
      void loadNote(notePath);
    }
  } catch (error) {
    console.error("/api/notes (create) request failed", error);
    showError("Unable to create note.");
  }
}

function getSelectedTreeItem() {
  const tree = getFancytreeInstance();
  if (!tree) return null;
  return tree.getActiveNode();
}

function canRenameType(type) {
  return type === "folder" || type === "note";
}

function canRenameTreeNode(node) {
  if (!node || !node.data) return false;
  return canRenameType(node.data.type);
}

function sanitizeNameInput(name) {
  return (name ?? "").trim();
}

function containsIllegalNameChars(name) {
  return /[\\/]/.test(name);
}

function ensureNoteFileName(name) {
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

function buildDestinationPath(sourcePath, destinationName) {
  const parts = sourcePath.split("/");
  if (parts.length === 0) {
    return destinationName;
  }
  parts[parts.length - 1] = destinationName;
  return parts.join("/");
}

function prepareInlineRenameInput(node, $input) {
  if (!$input || typeof $input.val !== "function" || !node) return;
  const nodeType = node.data?.type;
  if (nodeType === "note") {
    const title = node.title || "";
    if (title.toLowerCase().endsWith(".md")) {
      $input.val(title.slice(0, -3));
    }
  }
  queueMicrotask(() => {
    const el = $input.get ? $input.get(0) : null;
    if (el && typeof el.select === "function") {
      el.select();
    }
  });
}

function handleInlineRenameSave(node, $input) {
  if (!$input || typeof $input.val !== "function" || !node) {
    return false;
  }
  if (!canRenameTreeNode(node)) {
    return false;
  }
  const nodeType = node.data?.type;
  const path = node.data?.path || "";
  if (!path) {
    return false;
  }
  const rawValue = sanitizeNameInput($input.val());
  if (!rawValue) {
    showError("Name cannot be empty.");
    return false;
  }
  if (containsIllegalNameChars(rawValue)) {
    showError("Names cannot contain slashes.");
    return false;
  }
  const finalName = nodeType === "note" ? ensureNoteFileName(rawValue) : rawValue;
  $input.val(finalName);
  return true;
}

async function renameItem(sourcePath, destinationPath, nodeType) {
  if (!sourcePath || !destinationPath || sourcePath === destinationPath) {
    return;
  }

  const endpoint = nodeType === "folder" ? "/api/folders/rename" : "/api/notes/rename";
  const body = JSON.stringify({ sourcePath, destinationPath });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      throw new Error(`Rename request failed with status ${response.status}`);
    }

    let newPath = destinationPath;
    if (nodeType === "note") {
      const data = await response.json();
      if (typeof data?.path === "string") {
        newPath = data.path;
      }
    }

    await loadTree();

    if (nodeType === "note" && currentNotePath === sourcePath) {
      void loadNote(newPath, { replaceUrl: true });
    }
  } catch (error) {
    console.error("Rename request failed", error);
    showError("Unable to rename item.");
    await loadTree();
  }
}

async function handleRenameSelectedItem() {
  const item = getSelectedTreeItem();
  if (!item) return;

  if (typeof item.editStart === "function") {
    item.editStart();
    return;
  }

  await promptRenameFallback(item);
}

async function promptRenameFallback(item) {
  const path = item.data?.path || "";
  if (!path) return;

  const nodeType = item.data?.type;
  if (!canRenameType(nodeType)) return;

  const parts = path.split("/");
  const currentName = parts[parts.length - 1] || path;
  const isNote = nodeType === "note";

  const baseName =
    isNote && currentName.toLowerCase().endsWith(".md")
      ? currentName.slice(0, -3)
      : currentName;

  const input = window.prompt("Rename item", baseName);
  if (!input) return;

  const trimmed = input.trim();
  if (!trimmed) return;

  if (containsIllegalNameChars(trimmed)) {
    showError("Names cannot contain slashes.");
    return;
  }

  const finalName = isNote ? ensureNoteFileName(trimmed) : trimmed;
  const destPath = buildDestinationPath(path, finalName);
  await renameItem(path, destPath, nodeType);
}

async function handleDeleteSelectedItem() {
  const item = getSelectedTreeItem();
  if (!item) return;

  const path = item.data?.path || "";
  if (!path) return;

  const confirmed = window.confirm(
    "Delete this item and its contents (for folders)?",
  );
  if (!confirmed) return;

  const isNote = item.data?.type === "note";
  const isFolder = item.data?.type === "folder";

  try {
    if (isNote) {
      const safePath = toSafePath(path);
      const response = await fetch(`/api/notes/${safePath}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete note failed with status ${response.status}`);
      }
    } else if (isFolder) {
      const safePath = toSafePath(path);
      const response = await fetch(`/api/folders/${safePath}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete folder failed with status ${response.status}`);
      }
    }

    await loadTree();
  } catch (error) {
    console.error("Delete request failed", error);
    showError("Unable to delete item.");
  }
}

function setupTreeSelection() {
  const treeRootEl = document.getElementById("tree");
  if (!treeRootEl) return;

  treeRootEl.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const nodeElem = target.closest("span.fancytree-node");
    if (!nodeElem) return;

    event.preventDefault();

    const tree = getFancytreeInstance();
    if (!tree || !window.jQuery) return;

    const node = window.jQuery(nodeElem).data("ftNode");
    if (!node) return;

    node.setActive();
    openTreeContextMenu(event, node);
  });
}

let activeContextMenu = null;

function closeTreeContextMenu() {
  if (activeContextMenu && activeContextMenu.parentNode) {
    activeContextMenu.parentNode.removeChild(activeContextMenu);
  }
  activeContextMenu = null;
}

function openTreeContextMenu(event, node) {
  closeTreeContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  function addItem(label, handler, disabled) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-menu-item";
    btn.textContent = label;
    if (disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        closeTreeContextMenu();
        handler();
      });
    }
    menu.appendChild(btn);
  }

  const isFolder = node.data?.type === "folder";
  const isNote = node.data?.type === "note";

  addItem("New folder", () => {
    void handleNewFolderClick();
  }, !isFolder);

  addItem("New note", () => {
    void handleNewNoteClick();
  }, !isFolder);

  const sep = document.createElement("div");
  sep.className = "context-menu-separator";
  menu.appendChild(sep);

  addItem("Rename", () => {
    void handleRenameSelectedItem();
  }, !(isFolder || isNote));

  addItem("Delete", () => {
    void handleDeleteSelectedItem();
  }, !(isFolder || isNote));

  const sep2 = document.createElement("div");
  sep2.className = "context-menu-separator";
  menu.appendChild(sep2);

  addItem("Manage .gitignore (not yet implemented)", () => {
    showError("Gitignore management is not implemented yet.");
  }, false);

  document.body.appendChild(menu);
  activeContextMenu = menu;

  const { clientX, clientY } = event;
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;

  window.addEventListener(
    "click",
    () => {
      closeTreeContextMenu();
    },
    { once: true },
  );
}

function setActiveSettingsCategory(categoryId) {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;

  const navItems = overlay.querySelectorAll(".settings-nav-item");
  navItems.forEach((item) => {
    const id = item.dataset.settingsCategoryId;
    item.classList.toggle("selected", id === categoryId);
  });

  const sections = overlay.querySelectorAll("[data-settings-category]");
  sections.forEach((section) => {
    const id = section.dataset.settingsCategory;
    if (id === categoryId) {
      section.classList.remove("hidden");
    } else {
      section.classList.add("hidden");
    }
  });
}

function openSettingsModal() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;

  overlay.classList.remove("hidden");
  setActiveSettingsCategory("general");

  const firstNavItem = overlay.querySelector(".settings-nav-item");
  if (firstNavItem instanceof HTMLElement) {
    firstNavItem.focus();
  }
}

function closeSettingsModal() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;

  overlay.classList.add("hidden");
}

function setupSettingsModal() {
  const settingsBtn = document.getElementById("settings-btn");
  const overlay = document.getElementById("settings-overlay");
  const closeBtn = document.getElementById("settings-close-btn");
  const footerCloseBtn = document.getElementById("settings-footer-close-btn");

  if (!settingsBtn || !overlay || !closeBtn) return;

  function handleClose() {
    closeSettingsModal();
  }

  settingsBtn.addEventListener("click", () => {
    openSettingsModal();
  });

  closeBtn.addEventListener("click", () => {
    handleClose();
  });

  if (footerCloseBtn) {
    footerCloseBtn.addEventListener("click", () => {
      handleClose();
    });
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      handleClose();
    }
  });

  const navItems = overlay.querySelectorAll(".settings-nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const categoryId = item.dataset.settingsCategoryId;
      if (categoryId) {
        setActiveSettingsCategory(categoryId);
      }
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const overlayElement = document.getElementById("settings-overlay");
      if (!overlayElement || overlayElement.classList.contains("hidden")) {
        return;
      }
      event.preventDefault();
      handleClose();
    }
  });
}

function setupViewerScrollSync() {
  const viewerEl = document.getElementById("viewer");
  if (!viewerEl) return;

  viewerEl.addEventListener("scroll", () => {
    if (!monacoEditor) return;
    if (currentMode !== "edit") return;
    if (isSyncingScrollFromEditor) return;

    const viewerScrollable = viewerEl.scrollHeight - viewerEl.clientHeight;
    if (viewerScrollable <= 0) return;

    const ratio = viewerEl.scrollTop / viewerScrollable;
    const editorScrollHeight = monacoEditor.getScrollHeight();
    if (!editorScrollHeight) return;

    isSyncingScrollFromViewer = true;
    monacoEditor.setScrollTop(ratio * editorScrollHeight);
    isSyncingScrollFromViewer = false;
  });
}

window.addEventListener("DOMContentLoaded", () => {
  updateHealthStatus();
  loadTree();
  setupTreeSelection();
  setupNewItemButtons();
  setupModeToggle();
  initMonacoEditor();
  setupSettingsModal();
  setupSearch();
  initializeNavigationFromUrl();
  setupViewerScrollSync();
});

window.addEventListener("popstate", () => {
  const { note, mode } = getUrlState();
  if (note) {
    void loadNote(note, {
      skipUrlUpdate: true,
      modeOverride: mode,
      triggerAction: true,
    });
  } else {
    currentMode = normalizeMode(mode);
    clearCurrentNoteDisplay();
    const tree = getFancytreeInstance();
    if (tree) {
      const active = tree.getActiveNode();
      if (active) {
        active.setActive(false);
      }
    }
  }
});

function initializeNavigationFromUrl() {
  const { note, mode } = getUrlState();
  currentMode = mode;

  if (note) {
    void loadNote(note, {
      skipUrlUpdate: true,
      modeOverride: mode,
      replaceUrl: true,
      triggerAction: true,
    });
  } else {
    clearCurrentNoteDisplay();
    setMode(currentMode, { skipUrlUpdate: true });
  }
}
