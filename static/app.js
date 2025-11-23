let monacoEditor = null;
let markdownRenderer = null;
let currentNotePath = null;
let currentNoteContent = "";
let currentMode = "view";

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
  if (monacoEditor) return;

  const editorContainer = document.getElementById("editor");
  if (!editorContainer) return;

  if (typeof require === "undefined") {
    console.error("Monaco loader (require) is not available. Ensure /vendor/monaco/vs/loader.js is served.");
    return;
  }

  require.config({ paths: { vs: "/vendor/monaco/vs" } });

  require(["vs/editor/editor.main"], () => {
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

    monacoEditor.onDidChangeModelContent(() => {
      currentNoteContent = monacoEditor.getValue();
      if (currentMode === "edit") {
        updatePreviewFromEditor();
      }
    });

    monacoEditor.onDidScrollChange(() => {
      const viewerEl = document.getElementById("viewer");
      if (!viewerEl) return;

      const scrollTop = monacoEditor.getScrollTop();
      const scrollHeight = monacoEditor.getScrollHeight();
      if (!scrollHeight) return;

      const ratio = scrollTop / scrollHeight;
      const viewerScrollable = viewerEl.scrollHeight - viewerEl.clientHeight;
      if (viewerScrollable > 0) {
        viewerEl.scrollTop = ratio * viewerScrollable;
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

function setMode(mode) {
  currentMode = mode;

  const viewerEl = document.getElementById("viewer");
  const editorWrapperEl = document.getElementById("editor-wrapper");
  const modeToggleBtn = document.getElementById("mode-toggle-btn");

  if (!viewerEl || !editorWrapperEl || !modeToggleBtn) return;

  if (!currentNotePath) {
    modeToggleBtn.disabled = true;
    editorWrapperEl.classList.add("hidden");
    return;
  }

  modeToggleBtn.disabled = false;

  if (mode === "edit") {
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
}

function setupModeToggle() {
  const modeToggleBtn = document.getElementById("mode-toggle-btn");
  if (!modeToggleBtn) return;

  modeToggleBtn.addEventListener("click", async () => {
    if (!currentNotePath) return;

    if (currentMode === "view") {
      setMode("edit");
    } else {
      try {
        await saveCurrentNote();
        await loadNote(currentNotePath);
      } finally {
        setMode("view");
      }
    }
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

function createTreeItem(node) {
  const item = document.createElement("div");
  item.classList.add("tree-item", node.type);
  item.dataset.path = node.path;

  const icon = document.createElement("span");
  icon.classList.add("tree-icon");
  item.appendChild(icon);

  const label = document.createElement("span");
  label.classList.add("label");
  label.textContent = node.name;
  item.appendChild(label);

  return item;
}

function renderTreeNodes(nodes, container) {
  nodes.forEach((node) => {
    if (node.type === "folder") {
      const folderItem = createTreeItem(node);
      folderItem.classList.add("expanded");

      const childrenContainer = document.createElement("div");
      childrenContainer.classList.add("tree-children");

      const children = Array.isArray(node.children) ? node.children : [];
      renderTreeNodes(children, childrenContainer);

      container.appendChild(folderItem);
      container.appendChild(childrenContainer);
    } else {
      const leafItem = createTreeItem(node);
      container.appendChild(leafItem);
    }
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

    treeRootEl.textContent = "";
    const fragment = document.createDocumentFragment();
    renderTreeNodes(nodes, fragment);
    treeRootEl.appendChild(fragment);
  } catch (error) {
    console.error("/api/tree request failed", error);
    treeRootEl.textContent = "Unable to load notes tree.";
    showError("Unable to load notes tree from the server.");
  }
}

async function loadNote(notePath) {
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const viewerEl = document.getElementById("viewer");

  if (!viewerEl || !noteNameEl || !notePathEl) return;

  viewerEl.textContent = "Loading note…";

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

    if (monacoEditor && currentMode === "edit") {
      monacoEditor.setValue(currentNoteContent);
      updatePreviewFromEditor();
    }

    setMode(currentMode);
  } catch (error) {
    console.error("/api/notes request failed", error);
    showError("Unable to load the selected note from the server.");
    viewerEl.textContent = "Unable to load note.";
  }
}

function getBaseFolderPathForNewItem() {
  const treeRootEl = document.getElementById("tree");
  if (!treeRootEl) return "";

  const selected = treeRootEl.querySelector(".tree-item.selected");
  if (!selected) return "";

  const path = selected.dataset.path || "";
  if (!path) return "";

  if (selected.classList.contains("folder")) {
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
      loadNote(notePath);
    }
  } catch (error) {
    console.error("/api/notes (create) request failed", error);
    showError("Unable to create note.");
  }
}

function getSelectedTreeItem() {
  const treeRootEl = document.getElementById("tree");
  if (!treeRootEl) return null;
  return treeRootEl.querySelector(".tree-item.selected");
}

async function handleRenameSelectedItem() {
  const item = getSelectedTreeItem();
  if (!item) return;

  const path = item.dataset.path || "";
  if (!path) return;

  const parts = path.split("/");
  const currentName = parts[parts.length - 1] || path;
  const isNote = item.classList.contains("note");

  const baseName =
    isNote && currentName.toLowerCase().endsWith(".md")
      ? currentName.slice(0, -3)
      : currentName;

  const input = window.prompt("Rename item", baseName);
  if (!input) return;

  const trimmed = input.trim();
  if (!trimmed) return;

  parts[parts.length - 1] = trimmed;
  const destPath = parts.join("/");

  try {
    if (isNote) {
      const response = await fetch("/api/notes/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: path, destinationPath: destPath }),
      });

      if (!response.ok) {
        throw new Error(`Rename note failed with status ${response.status}`);
      }

      const data = await response.json();
      await loadTree();
      if (data.path) {
        loadNote(data.path);
      }
    } else if (item.classList.contains("folder")) {
      const response = await fetch("/api/folders/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: path, destinationPath: destPath }),
      });

      if (!response.ok) {
        throw new Error(`Rename folder failed with status ${response.status}`);
      }

      await loadTree();
    }
  } catch (error) {
    console.error("Rename request failed", error);
    showError("Unable to rename item.");
  }
}

async function handleDeleteSelectedItem() {
  const item = getSelectedTreeItem();
  if (!item) return;

  const path = item.dataset.path || "";
  if (!path) return;

  const confirmed = window.confirm(
    "Delete this item and its contents (for folders)?",
  );
  if (!confirmed) return;

  const isNote = item.classList.contains("note");
  const isFolder = item.classList.contains("folder");

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

  treeRootEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const item = target.closest(".tree-item");
    if (!item || !treeRootEl.contains(item)) return;

    const previouslySelected = treeRootEl.querySelector(".tree-item.selected");
    if (previouslySelected) {
      previouslySelected.classList.remove("selected");
    }

    item.classList.add("selected");

    const path = item.dataset.path;
    if (!path) return;

    if (item.classList.contains("note")) {
      loadNote(path);
    } else if (item.classList.contains("image")) {
      loadImage(path);
    }
  });

  treeRootEl.addEventListener("keydown", (event) => {
    if (event.key === "F2") {
      event.preventDefault();
      void handleRenameSelectedItem();
    } else if (event.key === "Delete") {
      event.preventDefault();
      void handleDeleteSelectedItem();
    }
  });
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

window.addEventListener("DOMContentLoaded", () => {
  updateHealthStatus();
  loadTree();
  setupTreeSelection();
  setupNewItemButtons();
  setupModeToggle();
  initMonacoEditor();
  setupSettingsModal();
});
