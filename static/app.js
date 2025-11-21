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

    const label = document.createElement("span");
    label.classList.add("label");
    label.textContent = node.name || "notes";
    label.style.paddingLeft = `${depth * 12 + 4}px`;
    item.appendChild(label);

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
      item.dataset.path = node.path;
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

  async function promptNewFolder() {
    const path = window.prompt(
      "New folder path (relative to notes root, e.g. 'projects' or 'work/personal')"
    );
    if (!path) return;
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

  async function promptNewNote() {
    const path = window.prompt(
      "New note path (relative to notes root, include .md, e.g. 'inbox.md' or 'work/todo.md')"
    );
    if (!path) return;
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
    promptNewFolder();
  });

  newNoteBtn.addEventListener("click", () => {
    promptNewNote();
  });

  setupSplitter();
  loadTree();
})();
