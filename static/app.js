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

function showError(message) {
  const banner = document.getElementById("error-banner");
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove("hidden");
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
    const safePath = notePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const response = await fetch(`/api/notes/${safePath}`);

    if (!response.ok) {
      throw new Error(`Note request failed with status ${response.status}`);
    }

    const data = await response.json();

    noteNameEl.textContent = data.name ?? "";
    notePathEl.textContent = data.path ?? notePath;
    viewerEl.innerHTML = data.html ?? "";
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

    if (item.classList.contains("note")) {
      const path = item.dataset.path;
      if (path) {
        loadNote(path);
      }
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  updateHealthStatus();
  loadTree();
  setupTreeSelection();
  setupNewItemButtons();
});
