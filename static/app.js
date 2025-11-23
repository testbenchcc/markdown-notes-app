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
  });
}

window.addEventListener("DOMContentLoaded", () => {
  updateHealthStatus();
  loadTree();
  setupTreeSelection();
});
