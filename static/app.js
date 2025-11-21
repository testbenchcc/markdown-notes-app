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

  const contextMenuEl = document.createElement("div");
  contextMenuEl.id = "context-menu";
  contextMenuEl.className = "context-menu hidden";
  document.body.appendChild(contextMenuEl);

  let contextMenuTarget = null;
  let contextMenuTargetEl = null;

  let currentNote = null; // { path, name, content, html }
  let mode = "view"; // "view" | "edit"

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
      items.push({ id: "new-note", label: "New note in folder" });
      items.push({ id: "new-folder", label: "New subfolder" });
      items.push({ separator: true });
      items.push({ id: "copy-path", label: "Copy folder path" });
    } else if (target.type === "note") {
      items.push({ id: "open-note", label: "Open note" });
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
      setMode("view");
    } catch (err) {
      viewerEl.textContent = "Failed to load note.";
      editorEl.value = "";
      currentNote = null;
      modeToggleBtn.disabled = true;
      saveBtn.disabled = true;
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

  newFolderBtn.addEventListener("click", () => {
    promptNewFolder("");
  });

  newNoteBtn.addEventListener("click", () => {
    promptNewNote("");
  });

  setupSplitter();
  loadTree();
})();
