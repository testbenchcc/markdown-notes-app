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

window.addEventListener("DOMContentLoaded", () => {
  updateHealthStatus();
  loadTree();
  setupTreeSelection();
  setupNewItemButtons();
});
