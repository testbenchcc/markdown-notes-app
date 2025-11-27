let monacoEditor = null;
let monacoLoading = false;
let markdownRenderer = null;
let currentNotePath = null;
let currentNoteContent = "";
let currentFileType = "markdown";
let currentMode = "view";
let treeInitialized = false;
let currentSearchHighlightIds = [];
let searchDebounceTimerId = null;
let latestSearchRequestId = 0;
let isSyncingScrollFromEditor = false;
let isSyncingScrollFromViewer = false;
let uploadBannerHideTimerId = null;
let errorBannerHideTimerId = null;
let notebookSettings = null;
let settingsDirty = false;
let suppressSettingsDirtyTracking = false;
const SETTINGS_LOCAL_STORAGE_KEY = "markdown-notes-app-settings";
let lastSettingsSaveCompletedAtMs = 0;
const SETTINGS_DOUBLE_SAVE_CLOSE_WINDOW_MS = 4000;
const DEFAULT_MERMAID_LOCAL_API_BASE_URL = "mermaid.husqy.net";
let mermaidSearchDebounceTimerId = null;
let mermaidLatestRequestId = 0;
let mermaidInsertInitialized = false;
let mermaidRemotePreviewLatestRequestId = 0;
const mermaidPreviewContentCache = new Map();
let mermaidInitialized = false;

const VALID_MODES = new Set(["view", "edit", "export", "download"]);
const DEFAULT_MODE = "view";
const TREE_AUTO_REFRESH_INTERVAL_MS = 15000;
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
    breaks: true
  });

  return markdownRenderer;
}

function buildMermaidErrorMessage(error, contextLabel) {
  const base = contextLabel && String(contextLabel).trim()
    ? String(contextLabel).trim()
    : "Mermaid diagram error";

  if (!error) {
    return base;
  }

  if (typeof error === "string") {
    return `${base}: ${error}`;
  }

  if (typeof error.message === "string" && error.message) {
    return `${base}: ${error.message}`;
  }

  if (typeof error.str === "string" && error.str) {
    return `${base}: ${error.str}`;
  }

  try {
    const asJson = JSON.stringify(error);
    if (asJson && asJson !== "{}") {
      return `${base}: ${asJson}`;
    }
  } catch {
  }

  return base;
}

function initializeMermaidIfNeeded() {
  if (mermaidInitialized) return;
  if (typeof window === "undefined") return;

  const mermaid = window.mermaid;
  if (!mermaid) return;

  try {
    if (typeof mermaid.setParseErrorHandler === "function") {
      mermaid.setParseErrorHandler((err) => {
        const message = buildMermaidErrorMessage(err, "Mermaid diagram parse error");
        if (typeof showError === "function") {
          showError(message);
        } else if (typeof console !== "undefined" && console && console.error) {
          console.error(message, err);
        }
      });
    } else if (Object.prototype.hasOwnProperty.call(mermaid, "parseError")) {
      mermaid.parseError = (err) => {
        const message = buildMermaidErrorMessage(err, "Mermaid diagram parse error");
        if (typeof showError === "function") {
          showError(message);
        } else if (typeof console !== "undefined" && console && console.error) {
          console.error(message, err);
        }
      };
    }
  } catch (error) {
    if (typeof console !== "undefined" && console && console.error) {
      console.error("Failed to attach Mermaid parse error handler", error);
    }
  }

  try {
    if (typeof mermaid.initialize === "function") {
      mermaid.initialize({ startOnLoad: false });
    }
  } catch (error) {
    if (typeof console !== "undefined" && console && console.error) {
      console.error("Failed to initialize Mermaid", error);
    }
  }

  mermaidInitialized = true;
}

function preprocessMermaidFences(text) {
  const lines = [];
  let inMermaid = false;
  let buffer = [];

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trimStart();

    if (
      !inMermaid &&
      trimmed.startsWith("```mermaid") &&
      !trimmed.startsWith("```mermaid-remote")
    ) {
      inMermaid = true;
      buffer = [];
      return;
    }

    if (inMermaid && trimmed.startsWith("```")) {
      inMermaid = false;
      const body = buffer.join("\n").replace(/^[\n]+|[\n]+$/g, "");
      lines.push(`<pre class="mermaid">${body}</pre>`);
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

async function fetchMermaidDiagramContentForPreview(diagramId) {
  const id = Number(diagramId);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  if (mermaidPreviewContentCache.has(id)) {
    return mermaidPreviewContentCache.get(id);
  }

  const url = buildMermaidLocalApiUrl(`/api/diagrams/${encodeURIComponent(String(id))}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      mermaidPreviewContentCache.set(id, null);
      return null;
    }

    const data = await response.json();
    const content = typeof data.content === "string" ? data.content : "";
    const normalized = content.trim() ? content : null;
    mermaidPreviewContentCache.set(id, normalized);
    return normalized;
  } catch (error) {
    console.error("Mermaid Local request failed for preview", error);
    mermaidPreviewContentCache.set(id, null);
    return null;
  }
}

async function expandMermaidRemoteBlocksForPreview(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let inRemote = false;
  let buffer = [];
  let startIndex = -1;
  let fenceIndent = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = line.trimStart();

    if (!inRemote && stripped.startsWith("```mermaid-remote")) {
      inRemote = true;
      buffer = [];
      startIndex = i;
      fenceIndent = line.slice(0, line.length - stripped.length);
      continue;
    }

    if (inRemote && stripped.startsWith("```")) {
      const endIndex = i;
      blocks.push({
        startIndex,
        endIndex,
        fenceIndent,
        bodyLines: buffer.slice(),
      });
      inRemote = false;
      buffer = [];
      fenceIndent = "";
      continue;
    }

    if (inRemote) {
      buffer.push(line);
    }
  }

  if (!blocks.length) {
    return text;
  }

  const replacementsByStart = new Map();

  await Promise.all(
    blocks.map(async (block) => {
      let diagramId = null;

      for (const bodyLine of block.bodyLines) {
        const bodyStripped = bodyLine.trim();
        if (!bodyStripped || bodyStripped.indexOf(":") === -1) {
          continue;
        }
        const [rawKey, ...rest] = bodyStripped.split(":");
        const key = rawKey.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "id") {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            diagramId = parsed;
          }
          break;
        }
      }

      let replacementLines = null;

      if (diagramId !== null) {
        const content = await fetchMermaidDiagramContentForPreview(diagramId);
        if (typeof content === "string" && content.trim()) {
          const body = content.replace(/\r?\n$/, "");
          const contentLines = body.split(/\r?\n/);
          replacementLines = [
            `${block.fenceIndent}\`\`\`mermaid`,
            ...contentLines.map((l) => `${block.fenceIndent}${l}`),
            `${block.fenceIndent}\`\`\``,
          ];
        }
      }

      if (!replacementLines) {
        replacementLines = lines.slice(block.startIndex, block.endIndex + 1);
      }

      replacementsByStart.set(block.startIndex, {
        endIndex: block.endIndex,
        lines: replacementLines,
      });
    }),
  );

  const resultLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    const replacement = replacementsByStart.get(i);
    if (replacement) {
      resultLines.push(...replacement.lines);
      i = replacement.endIndex;
    } else {
      resultLines.push(lines[i]);
    }
  }

  return resultLines.join("\n");
}

function renderViewerHtml(html) {
  const viewerEl = document.getElementById("viewer");
  if (!viewerEl) return;

  viewerEl.classList.remove("text-file-view", "csv-table-view");
  viewerEl.innerHTML = html;

  if (window.mermaid && typeof window.mermaid.init === "function") {
    initializeMermaidIfNeeded();
    const mermaidNodes = viewerEl.querySelectorAll(".mermaid");
    if (mermaidNodes.length) {
      try {
        const result = window.mermaid.init(undefined, mermaidNodes);
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            console.error("Mermaid rendering failed", error);
            if (typeof showError === "function") {
              showError(buildMermaidErrorMessage(error, "Mermaid rendering failed"));
            }
          });
        }
      } catch (error) {
        console.error("Mermaid rendering failed", error);
        if (typeof showError === "function") {
          showError(buildMermaidErrorMessage(error, "Mermaid rendering failed"));
        }
      }
    }
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let currentCsvTable = null;

function renderTextFileView(content) {
  const viewerEl = document.getElementById("viewer");
  if (!viewerEl) return;

  viewerEl.classList.add("text-file-view");
  viewerEl.classList.remove("csv-table-view");
  viewerEl.innerHTML = `<pre>${escapeHtml(content || "")}</pre>`;
}

function renderCsvView(content) {
  const viewerEl = document.getElementById("viewer");
  if (!viewerEl) return;

  viewerEl.classList.remove("text-file-view");
  viewerEl.classList.add("csv-table-view");
  viewerEl.innerHTML = "";

  if (currentCsvTable && typeof currentCsvTable.destroy === "function") {
    currentCsvTable.destroy();
    currentCsvTable = null;
  }

  if (!window.Tabulator) {
    const fallback = document.createElement("pre");
    fallback.textContent = content || "";
    viewerEl.appendChild(fallback);
    return;
  }

  const raw = content || "";
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    const empty = document.createElement("div");
    empty.textContent = "CSV file is empty.";
    viewerEl.appendChild(empty);
    return;
  }

  const headerCells = lines[0].split(",");
  const hasHeader = headerCells.every((cell) => cell.trim() !== "");

  const headers = hasHeader
    ? headerCells.map((h) => h.trim() || "Column")
    : headerCells.map((_, idx) => `Column ${idx + 1}`);

  const dataLines = hasHeader ? lines.slice(1) : lines;

  const columns = headers.map((title, index) => ({
    title,
    field: `col${index}`,
  }));

  const data = dataLines.map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((_, index) => {
      row[`col${index}`] = (cells[index] ?? "").trim();
    });
    return row;
  });

  currentCsvTable = new window.Tabulator(viewerEl, {
    data,
    columns,
    layout: "fitDataStretch",
    height: "100%",
  });
}

function getLanguageForPath(path, fileType) {
  if (fileType === "markdown") return "markdown";

  const lower = (path || "").toLowerCase();

  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".csv")) return "plaintext";

  return "plaintext";
}

function setMonacoLanguageForCurrentFile() {
  if (!monacoEditor || typeof monaco === "undefined") return;
  const model = monacoEditor.getModel();
  if (!model) return;

  const lang = getLanguageForPath(currentNotePath || "", currentFileType);
  monaco.editor.setModelLanguage(model, lang);
}

function parseUtcIsoToDate(isoString) {
  if (!isoString || typeof isoString !== "string") return null;

  const trimmed = isoString.trim();
  if (!trimmed) return null;

  let safe = trimmed;
  const match = safe.match(/^(.*\d)(\.\d+)(Z?)$/);
  if (match && match[2].length > 4) {
    const frac = match[2].slice(0, 4);
    safe = match[1] + frac + match[3];
  }

  const timestamp = Date.parse(safe);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp);
}

function formatAutoSyncTimestamp(isoString, timeZone) {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
    return isoString;
  }

  const date = parseUtcIsoToDate(isoString);
  if (!date) return isoString;

  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };

  let formatter = null;
  let targetTimeZone = null;

  if (timeZone && typeof timeZone === "string" && timeZone.trim()) {
    try {
      targetTimeZone = timeZone.trim();
      formatter = new Intl.DateTimeFormat(undefined, {
        ...options,
        timeZone: targetTimeZone,
      });
    } catch {
      formatter = null;
      targetTimeZone = null;
    }
  }

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, options);
  }

  const formatted = formatter.format(date);
  if (targetTimeZone) {
    return `${formatted} [${targetTimeZone}]`;
  }

  return formatted;
}

function applyImageSettingsFromSettings(settings) {
  if (!settings || typeof document === "undefined") return;

  const root = document.documentElement;
  if (!root || !root.style) return;

  const fitToNoteWidth = Boolean(settings.imageFitToNoteWidth);
  const maxWidth = Number.isFinite(settings.imageMaxWidth)
    ? settings.imageMaxWidth
    : 768;
  const maxHeight = Number.isFinite(settings.imageMaxHeight)
    ? settings.imageMaxHeight
    : 768;

  const widthValue = fitToNoteWidth ? "100%" : `${maxWidth}px`;
  root.style.setProperty("--viewer-image-max-width", widthValue);
  root.style.setProperty("--viewer-image-max-height", `${maxHeight}px`);
}

function applySettingsToMermaidSection(settings) {
  if (!settings || typeof document === "undefined") return;

  const baseUrlEl = document.getElementById("settings-mermaid-local-api-base-url");
  if (baseUrlEl) {
    const value = settings.mermaidLocalApiBaseUrl || DEFAULT_MERMAID_LOCAL_API_BASE_URL;
    baseUrlEl.value = value;
  }
}

function applySettingsToGeneralSection(settings) {
  if (!settings || typeof document === "undefined") return;

  const timeZoneEl = document.getElementById("settings-time-zone");
  if (timeZoneEl) {
    const value =
      settings.timeZone && typeof settings.timeZone === "string"
        ? settings.timeZone
        : "";
    timeZoneEl.value = value;
  }
}

function applySettingsToEditorSection(settings) {
  if (!settings || typeof document === "undefined") return;

  const tabLengthEl = document.getElementById("settings-tab-length");
  if (tabLengthEl) {
    const value = Number.isFinite(settings.tabLength) ? settings.tabLength : 4;
    tabLengthEl.value = String(value);
  }
}

function applyIndexTitleLive(title) {
  if (typeof document === "undefined") return;

  const navTitleEl = document.getElementById("nav-title");
  const safeTitle = title && String(title).trim() ? String(title).trim() : "NoteBooks";

  if (navTitleEl) {
    navTitleEl.textContent = safeTitle;
  }

  document.title = safeTitle;
}

function applyThemeFromSettings(settings) {
  if (!settings || typeof document === "undefined") return;

  const root = document.documentElement;
  if (!root || !root.style) return;

  const themeName =
    settings && typeof settings.theme === "string"
      ? settings.theme.toLowerCase()
      : "base";

  let palette;

  if (themeName === "office") {
    palette = {
      "--md-bg": "#1f2937",
      "--md-bg-alt": "#111827",
      "--md-bg-alt-soft": "#374151",
      "--md-border-subtle": "#4b5563",
      "--md-text-main": "#e5e7eb",
      "--md-text-muted": "#9ca3af",
      "--md-h1": "#2563eb",
      "--md-h2": "#059669",
      "--md-h3": "#d97706",
      "--md-h4": "#7c3aed",
      "--md-h5": "#db2777",
      "--md-h6": "#0ea5e9",
      "--md-aqua": "#22c55e",
      "--md-blue": "#2563eb",
      "--md-purple": "#7c3aed",
      "--md-link": "#22c55e",
      "--md-link-hover": "#f97316",
      "--md-code": "#a5b4fc",
      "--md-menu-bg": "#374151",
    };
  } else if (themeName === "high-contrast") {
    palette = {
      "--md-bg": "#000000",
      "--md-bg-alt": "#111111",
      "--md-bg-alt-soft": "#1f2933",
      "--md-border-subtle": "#ffffff",
      "--md-text-main": "#ffffff",
      "--md-text-muted": "#d1d5db",
      "--md-h1": "#f97316",
      "--md-h2": "#22c55e",
      "--md-h3": "#3b82f6",
      "--md-h4": "#eab308",
      "--md-h5": "#ec4899",
      "--md-h6": "#a855f7",
      "--md-aqua": "#22c55e",
      "--md-blue": "#3b82f6",
      "--md-purple": "#a855f7",
      "--md-link": "#22c55e",
      "--md-link-hover": "#facc15",
      "--md-code": "#a5b4fc",
      "--md-menu-bg": "#111827",
    };
  } else if (themeName === "midnight") {
    palette = {
      "--md-bg": "#020617",
      "--md-bg-alt": "#020617",
      "--md-bg-alt-soft": "#0f172a",
      "--md-border-subtle": "#1e293b",
      "--md-text-main": "#e5e7eb",
      "--md-text-muted": "#9ca3af",
      "--md-h1": "#38bdf8",
      "--md-h2": "#a855f7",
      "--md-h3": "#f97316",
      "--md-h4": "#22c55e",
      "--md-h5": "#e11d48",
      "--md-h6": "#eab308",
      "--md-aqua": "#22c55e",
      "--md-blue": "#38bdf8",
      "--md-purple": "#a855f7",
      "--md-link": "#38bdf8",
      "--md-link-hover": "#facc15",
      "--md-code": "#a5b4fc",
      "--md-menu-bg": "#020617",
    };
  } else {
    palette = {
      "--md-bg": "#1d2021",
      "--md-bg-alt": "#282828",
      "--md-bg-alt-soft": "#3c3836",
      "--md-border-subtle": "#3c3836",
      "--md-text-main": "#ebdbb2",
      "--md-text-muted": "#bdae93",
      "--md-h1": "#cc241d",
      "--md-h2": "#d79921",
      "--md-h3": "#98971a",
      "--md-h4": "#458588",
      "--md-h5": "#b16286",
      "--md-h6": "#8ec07c",
      "--md-aqua": "#8ec07c",
      "--md-blue": "#458588",
      "--md-purple": "#b16286",
      "--md-link": "#8ec07c",
      "--md-link-hover": "#fe8019",
      "--md-code": "#83a598",
      "--md-menu-bg": "#615d5b",
    };
  }

  Object.keys(palette).forEach((key) => {
    root.style.setProperty(key, palette[key]);
  });
}

function applySettingsToAppearanceSection(settings) {
  if (!settings || typeof document === "undefined") return;

  const titleInput = document.getElementById("settings-index-page-title");
  const themeSelect = document.getElementById("settings-theme");
  const titleValue = settings.indexPageTitle || "NoteBooks";

  if (titleInput) {
    titleInput.value = titleValue;
  }

  if (themeSelect && settings.theme) {
    themeSelect.value = settings.theme;
  }

  applyIndexTitleLive(titleValue);
  applyThemeFromSettings(settings);
}

function applySettingsToVersioningSection(settings) {
  if (!settings || typeof document === "undefined") return;

  const autoCommitEnabledEl = document.getElementById("settings-auto-commit-enabled");
  if (autoCommitEnabledEl) {
    autoCommitEnabledEl.checked = Boolean(settings.autoCommitEnabled);
  }

  const autoCommitIntervalEl = document.getElementById("settings-auto-commit-interval");
  if (autoCommitIntervalEl) {
    const seconds = settings.autoCommitIntervalSeconds;
    if (Number.isFinite(seconds) && seconds > 0) {
      autoCommitIntervalEl.value = String(seconds);
    } else {
      autoCommitIntervalEl.value = "";
    }
  }

  const autoPullEnabledEl = document.getElementById("settings-auto-pull-enabled");
  if (autoPullEnabledEl) {
    autoPullEnabledEl.checked = Boolean(settings.autoPullEnabled);
  }

  const autoPullIntervalEl = document.getElementById("settings-auto-pull-interval-minutes");
  if (autoPullIntervalEl) {
    const seconds = settings.autoPullIntervalSeconds;
    if (Number.isFinite(seconds) && seconds > 0) {
      const minutes = Math.round(seconds / 60);
      autoPullIntervalEl.value = String(minutes);
    } else {
      autoPullIntervalEl.value = "";
    }
  }

  const autoPushEnabledEl = document.getElementById("settings-auto-push-enabled");
  if (autoPushEnabledEl) {
    autoPushEnabledEl.checked = Boolean(settings.autoPushEnabled);
  }

  const autoPushIntervalEl = document.getElementById("settings-auto-push-interval-minutes");
  if (autoPushIntervalEl) {
    const seconds = settings.autoPushIntervalSeconds;
    if (Number.isFinite(seconds) && seconds > 0) {
      const minutes = Math.round(seconds / 60);
      autoPushIntervalEl.value = String(minutes);
    } else {
      autoPushIntervalEl.value = "";
    }
  }
}

function applyAutoSyncStatusToUi(payload) {
  if (typeof document === "undefined") return;

  const statusEl = document.getElementById("settings-auto-sync-status-text");
  if (!statusEl) return;

  if (!payload || !payload.state) {
    statusEl.textContent = "Auto-sync status is unavailable.";
    return;
  }

  const settings = payload.settings || {};
  const timeZone =
    settings && typeof settings.timeZone === "string" && settings.timeZone.trim()
      ? settings.timeZone.trim()
      : null;

  const state = payload.state || {};
  const commit = state.commit || {};
  const pull = state.pull || {};
  const push = state.push || {};
  const conflict = state.conflict || {};

  const lines = [];

  const commitParts = [`Commit: ${String(commit.lastStatus || "idle")}`];
  if (commit.lastRunCompletedAt) {
    commitParts.push(
      `last at ${formatAutoSyncTimestamp(commit.lastRunCompletedAt, timeZone)}`,
    );
  }
  lines.push(commitParts.join(" "));

  const pullParts = [`Pull: ${String(pull.lastStatus || "idle")}`];
  if (pull.lastRunCompletedAt) {
    pullParts.push(
      `last at ${formatAutoSyncTimestamp(pull.lastRunCompletedAt, timeZone)}`,
    );
  }
  lines.push(pullParts.join(" "));

  const pushParts = [`Push: ${String(push.lastStatus || "idle")}`];
  if (push.lastRunCompletedAt) {
    pushParts.push(
      `last at ${formatAutoSyncTimestamp(push.lastRunCompletedAt, timeZone)}`,
    );
  }
  lines.push(pushParts.join(" "));

  if (conflict && conflict.active) {
    const branch = conflict.conflictBranch || "unknown branch";
    lines.push(`Conflict: active on ${branch}`);
  } else if (conflict && conflict.lastConflictAt) {
    lines.push(
      `Conflict: last recorded at ${formatAutoSyncTimestamp(
        conflict.lastConflictAt,
        timeZone,
      )}`,
    );
  }

  statusEl.textContent = lines.join("\n");
}

async function loadAutoSyncStatus() {
  if (typeof document === "undefined") return;

  const statusEl = document.getElementById("settings-auto-sync-status-text");
  if (statusEl) {
    statusEl.textContent = "Loading auto-sync status…";
  }

  try {
    const response = await fetch("/api/versioning/notes/auto-sync-status");

    if (!response.ok) {
      throw new Error(
        `Auto-sync status request failed with status ${response.status}`,
      );
    }

    const data = await response.json();
    applyAutoSyncStatusToUi(data);
  } catch (error) {
    console.error(
      "/api/versioning/notes/auto-sync-status request failed",
      error,
    );
    if (statusEl) {
      statusEl.textContent = "Unable to load auto-sync status.";
    }
  }
}

async function runManualCommitAndPush() {
  try {
    const response = await fetch("/api/versioning/notes/commit-and-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      let detail = `request failed with status ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.detail) {
          detail = data.detail;
        }
      } catch {
        // ignore JSON parse errors
      }
      showError(`Commit & push failed: ${detail}`);
      return;
    }

    const data = await response.json();
    const committed = Boolean(data.committed);
    const pushed = Boolean(data.pushed);
    const pushInfo = data.push || {};
    const pushStatus = String(pushInfo.status || "");

    let message;

    if (pushStatus === "error" && pushInfo.detail) {
      message = `Commit & push: push error - ${pushInfo.detail}`;
    } else if (!committed && !pushed) {
      message = "Commit & push: no changes to commit.";
    } else if (committed && !pushed) {
      message = "Commit & push: committed local changes; push skipped.";
    } else if (!committed && pushed) {
      message = "Commit & push: pushed existing commits.";
    } else {
      message = "Commit & push: committed and pushed notes successfully.";
    }

    showError(message);
  } catch (error) {
    console.error("/api/versioning/notes/commit-and-push request failed", error);
    showError("Commit & push failed due to a network or server error.");
  }

  void loadAutoSyncStatus();
}

async function runManualPull() {
  try {
    const response = await fetch("/api/versioning/notes/pull", {
      method: "POST",
    });

    if (!response.ok) {
      let detail = `request failed with status ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.detail) {
          detail = data.detail;
        }
      } catch {
        // ignore JSON parse errors
      }
      showError(`Pull failed: ${detail}`);
      return;
    }

    const data = await response.json();
    const status = String(data.status || "unknown");

    let message;
    if (status === "ok") {
      message = "Pull: completed successfully.";
    } else if (status === "skipped") {
      const detail = data.detail || "operation skipped.";
      message = `Pull: skipped - ${detail}`;
    } else if (status === "conflict") {
      const branch = data.conflictBranch || "conflict branch";
      message = `Pull: conflict detected; local changes preserved on ${branch}.`;
    } else {
      const errorText = data.error || data.detail;
      message = errorText ? `Pull failed: ${errorText}` : "Pull failed.";
    }

    showError(message);
  } catch (error) {
    console.error("/api/versioning/notes/pull request failed", error);
    showError("Pull failed due to a network or server error.");
  }

  void loadAutoSyncStatus();
}

function applyAllSettings(settings, options = {}) {
  const { resetDirty = false } = options;
  if (!settings) return;
  suppressSettingsDirtyTracking = true;
  applySettingsToGeneralSection(settings);
  applyImageSettingsFromSettings(settings);
  applySettingsToFilesAndImagesSection(settings);
  applySettingsToEditorSection(settings);
  applySettingsToAppearanceSection(settings);
  applySettingsToMermaidSection(settings);
  applySettingsToVersioningSection(settings);
  suppressSettingsDirtyTracking = false;
  if (resetDirty) {
    resetSettingsDirtyState();
  }
}

function loadSettingsFromLocalCache() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSettingsToLocalCache(settings) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const json = JSON.stringify(settings || {});
    window.localStorage.setItem(SETTINGS_LOCAL_STORAGE_KEY, json);
  } catch {
  }
}

function applySettingsToFilesAndImagesSection(settings) {
  if (!settings || typeof document === "undefined") return;

  const storageModeEl = document.getElementById("settings-image-storage-mode");
  if (storageModeEl) {
    storageModeEl.value = settings.imageStorageMode || "local";
  }

  const storageSubfolderEl = document.getElementById("settings-image-storage-subfolder");
  if (storageSubfolderEl) {
    storageSubfolderEl.value = settings.imageStorageSubfolder || "Images";
  }

  const localSubfolderEl = document.getElementById("settings-image-local-subfolder-name");
  if (localSubfolderEl) {
    localSubfolderEl.value = settings.imageLocalSubfolderName || "Images";
  }

  const displayModeEl = document.getElementById("settings-image-display-mode");
  if (displayModeEl) {
    const fitToNoteWidth = Boolean(settings.imageFitToNoteWidth);
    displayModeEl.value = fitToNoteWidth ? "fit-width" : "max-dimensions";
  }

  const maxWidthEl = document.getElementById("settings-image-max-width");
  if (maxWidthEl) {
    const maxWidth = Number.isFinite(settings.imageMaxWidth)
      ? settings.imageMaxWidth
      : 768;
    maxWidthEl.value = String(maxWidth);
  }

  const maxHeightEl = document.getElementById("settings-image-max-height");
  if (maxHeightEl) {
    const maxHeight = Number.isFinite(settings.imageMaxHeight)
      ? settings.imageMaxHeight
      : 768;
    maxHeightEl.value = String(maxHeight);
  }

  const maxPasteMbEl = document.getElementById("settings-image-max-paste-mb");
  if (maxPasteMbEl) {
    const maxBytes = settings.imageMaxPasteBytes;
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      const mb = maxBytes / (1024 * 1024);
      maxPasteMbEl.value = String(Math.round(mb * 10) / 10);
    } else {
      maxPasteMbEl.value = "";
    }
  }
}

function buildUpdatedSettingsFromFilesAndImagesSection(baseSettings) {
  if (typeof document === "undefined") return baseSettings || {};

  const next = { ...(baseSettings || {}) };

  const storageModeEl = document.getElementById("settings-image-storage-mode");
  if (storageModeEl && storageModeEl.value) {
    next.imageStorageMode = storageModeEl.value;
  }

  const storageSubfolderEl = document.getElementById("settings-image-storage-subfolder");
  if (storageSubfolderEl) {
    const value = storageSubfolderEl.value.trim();
    if (value) {
      next.imageStorageSubfolder = value;
    }
  }

  const localSubfolderEl = document.getElementById("settings-image-local-subfolder-name");
  if (localSubfolderEl) {
    const value = localSubfolderEl.value.trim();
    if (value) {
      next.imageLocalSubfolderName = value;
    }
  }

  const displayModeEl = document.getElementById("settings-image-display-mode");
  if (displayModeEl && displayModeEl.value) {
    const mode = displayModeEl.value;
    if (mode === "fit-width") {
      next.imageFitToNoteWidth = true;
    } else if (mode === "max-dimensions") {
      next.imageFitToNoteWidth = false;
    }
  }

  const maxWidthEl = document.getElementById("settings-image-max-width");
  if (maxWidthEl) {
    const parsed = Number.parseInt(maxWidthEl.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.imageMaxWidth = parsed;
    }
  }

  const maxHeightEl = document.getElementById("settings-image-max-height");
  if (maxHeightEl) {
    const parsed = Number.parseInt(maxHeightEl.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.imageMaxHeight = parsed;
    }
  }

  const maxPasteMbEl = document.getElementById("settings-image-max-paste-mb");
  if (maxPasteMbEl) {
    const raw = maxPasteMbEl.value.trim();
    if (!raw) {
      next.imageMaxPasteBytes = null;
    } else {
      const mb = Number.parseFloat(raw);
      if (Number.isFinite(mb) && mb > 0) {
        const bytes = Math.round(mb * 1024 * 1024);
        next.imageMaxPasteBytes = bytes;
      }
    }
  }

  return next;
}

function buildUpdatedSettingsFromEditorSection(baseSettings) {
  if (typeof document === "undefined") return baseSettings || {};

  const next = { ...(baseSettings || {}) };

  const tabLengthEl = document.getElementById("settings-tab-length");
  if (tabLengthEl) {
    const raw = tabLengthEl.value.trim();
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        next.tabLength = parsed;
      }
    }
  }

  return next;
}

function buildUpdatedSettingsFromAppearanceSection(baseSettings) {
  if (typeof document === "undefined") return baseSettings || {};

  const next = { ...(baseSettings || {}) };

  const titleEl = document.getElementById("settings-index-page-title");
  if (titleEl) {
    const value = titleEl.value.trim();
    if (value) {
      next.indexPageTitle = value;
    }
  }

  const themeEl = document.getElementById("settings-theme");
  if (themeEl && themeEl.value) {
    next.theme = themeEl.value;
  }

  return next;
}

function buildUpdatedSettingsFromAllSections(baseSettings) {
  let next = baseSettings || {};
  next = buildUpdatedSettingsFromGeneralSection(next);
  next = buildUpdatedSettingsFromFilesAndImagesSection(next);
  next = buildUpdatedSettingsFromMermaidSection(next);
  next = buildUpdatedSettingsFromEditorSection(next);
  next = buildUpdatedSettingsFromAppearanceSection(next);
  next = buildUpdatedSettingsFromVersioningSection(next);
  return next;
}

function buildUpdatedSettingsFromMermaidSection(baseSettings) {
  if (typeof document === "undefined") return baseSettings || {};

  const next = { ...(baseSettings || {}) };
  const baseUrlEl = document.getElementById("settings-mermaid-local-api-base-url");
  if (baseUrlEl) {
    const value = baseUrlEl.value.trim();
    if (value) {
      next.mermaidLocalApiBaseUrl = value;
    }
  }

  return next;
}

function buildUpdatedSettingsFromGeneralSection(baseSettings) {
  if (typeof document === "undefined") return baseSettings || {};

  const next = { ...(baseSettings || {}) };

  const timeZoneEl = document.getElementById("settings-time-zone");
  if (timeZoneEl) {
    const raw = timeZoneEl.value.trim();
    if (!raw) {
      next.timeZone = null;
    } else {
      next.timeZone = raw;
    }
  }

  return next;
}

function buildUpdatedSettingsFromVersioningSection(baseSettings) {
  if (typeof document === "undefined") return baseSettings || {};

  const next = { ...(baseSettings || {}) };

  const autoCommitEnabledEl = document.getElementById(
    "settings-auto-commit-enabled",
  );
  if (autoCommitEnabledEl) {
    next.autoCommitEnabled = Boolean(autoCommitEnabledEl.checked);
  }

  const autoCommitIntervalEl = document.getElementById(
    "settings-auto-commit-interval",
  );
  if (autoCommitIntervalEl) {
    const raw = autoCommitIntervalEl.value.trim();
    if (!raw) {
      next.autoCommitIntervalSeconds = null;
    } else {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.autoCommitIntervalSeconds = parsed;
      }
    }
  }

  const autoPullEnabledEl = document.getElementById(
    "settings-auto-pull-enabled",
  );
  if (autoPullEnabledEl) {
    next.autoPullEnabled = Boolean(autoPullEnabledEl.checked);
  }

  const autoPullIntervalEl = document.getElementById(
    "settings-auto-pull-interval-minutes",
  );
  if (autoPullIntervalEl) {
    const raw = autoPullIntervalEl.value.trim();
    if (!raw) {
      next.autoPullIntervalSeconds = null;
    } else {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.autoPullIntervalSeconds = parsed * 60;
      }
    }
  }

  const autoPushEnabledEl = document.getElementById(
    "settings-auto-push-enabled",
  );
  if (autoPushEnabledEl) {
    next.autoPushEnabled = Boolean(autoPushEnabledEl.checked);
  }

  const autoPushIntervalEl = document.getElementById(
    "settings-auto-push-interval-minutes",
  );
  if (autoPushIntervalEl) {
    const raw = autoPushIntervalEl.value.trim();
    if (!raw) {
      next.autoPushIntervalSeconds = null;
    } else {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.autoPushIntervalSeconds = parsed * 60;
      }
    }
  }

  return next;
}

async function handleSettingsSave() {
  const now = Date.now();

  if (
    isSettingsModalOpen() &&
    !settingsDirty &&
    lastSettingsSaveCompletedAtMs &&
    now - lastSettingsSaveCompletedAtMs <= SETTINGS_DOUBLE_SAVE_CLOSE_WINDOW_MS
  ) {
    closeSettingsModal();
    return;
  }

  const current = notebookSettings || {};
  const payload = buildUpdatedSettingsFromAllSections(current);

  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Settings save failed with status ${response.status}`);
    }

    const data = await response.json();
    const settings = data && typeof data.settings === "object" ? data.settings : {};
    notebookSettings = settings;
    saveSettingsToLocalCache(settings);
    applyAllSettings(settings, { resetDirty: true });
    lastSettingsSaveCompletedAtMs = Date.now();
  } catch (error) {
    console.error("/api/settings (save) request failed", error);
    showError("Unable to save settings.");
  }
}

async function handleRunImageCleanup() {
  try {
    const response = await fetch("/api/images/cleanup", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Image cleanup request failed with status ${response.status}`);
    }

    const data = await response.json();
    const total = typeof data.totalImages === "number" ? data.totalImages : 0;
    const unused = typeof data.unusedImages === "number" ? data.unusedImages : 0;
    const message = `Image cleanup dry run: ${unused} unused of ${total} total images.`;
    showError(message);
  } catch (error) {
    console.error("/api/images/cleanup request failed", error);
    showError("Unable to run image cleanup.");
  }
}

function triggerNotebookExport() {
  const link = document.createElement("a");
  link.href = "/api/export";
  link.download = "";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function loadNotebookSettings() {
  try {
    const response = await fetch("/api/settings");

    if (!response.ok) {
      throw new Error(`Settings request failed with status ${response.status}`);
    }

    const data = await response.json();
    const settings = data && typeof data.settings === "object" ? data.settings : {};
    notebookSettings = settings;
    saveSettingsToLocalCache(settings);
    applyAllSettings(settings, { resetDirty: true });
  } catch (error) {
    console.error("/api/settings request failed", error);
  }
}

function clearCurrentNoteDisplay() {
  const viewerEl = document.getElementById("viewer");
  const noteNameEl = document.getElementById("note-name");
  const notePathEl = document.getElementById("note-path");
  const exportBtn = document.getElementById("note-export-btn");
  const downloadBtn = document.getElementById("note-download-btn");

  if (viewerEl) {
    viewerEl.textContent = "Select a note from the tree to get started.";
    viewerEl.classList.remove("hidden");
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
  const value = monacoEditor.getValue();

  if (currentFileType === "markdown") {
    const md = ensureMarkdownRenderer();
    if (!md) return;

    const requestId = ++mermaidRemotePreviewLatestRequestId;

    (async () => {
      let expanded = value;
      try {
        expanded = await expandMermaidRemoteBlocksForPreview(value);
      } catch (error) {
        console.error("Mermaid-remote expansion for preview failed", error);
        expanded = value;
      }

      if (requestId !== mermaidRemotePreviewLatestRequestId) {
        return;
      }

      const processed = preprocessMermaidFences(expanded);
      const html = md.render(processed);
      renderViewerHtml(html);
    })();
  } else if (currentFileType === "csv") {
    // CSV remains view-only: just refresh the table view if needed.
    renderCsvView(value);
  } else {
    // Generic text files: keep the viewer in sync using the text-file view.
    renderTextFileView(value);
  }
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

    setMonacoLanguageForCurrentFile();

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
  const canEditInMonaco = currentFileType === "markdown" || currentFileType === "text";
  const effectiveMode = !canEditInMonaco && normalizedMode === "edit" ? "view" : normalizedMode;
  currentMode = effectiveMode;

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

  const shouldShowEditor =
    (currentFileType === "markdown" && effectiveMode === "edit") ||
    currentFileType === "text";

  modeToggleBtn.disabled = !canEditInMonaco;
  downloadBtn.disabled = false;
  exportBtn.disabled = currentFileType !== "markdown";

  if (shouldShowEditor) {
    editorWrapperEl.classList.remove("hidden");
  } else {
    editorWrapperEl.classList.add("hidden");
  }

  if (effectiveMode === "edit") {
    modeToggleBtn.setAttribute("aria-label", "View");
    modeToggleBtn.setAttribute("title", "View");
  } else {
    modeToggleBtn.setAttribute("aria-label", "Edit");
    modeToggleBtn.setAttribute("title", "Edit");
  }

  if (shouldShowEditor) {
    initMonacoEditor();

    if (monacoEditor) {
      setMonacoLanguageForCurrentFile();
      // Markdown is editable only in edit mode. Text-based files use Monaco in
      // both view and edit modes: read-only in view, editable in edit.
      const readOnly = currentFileType === "text" && effectiveMode !== "edit";
      monacoEditor.updateOptions({ readOnly });
      monacoEditor.setValue(currentNoteContent || "");
      updatePreviewFromEditor();
    }
  }

  if (!skipUrlUpdate && currentNotePath) {
    updateUrlState(currentNotePath, effectiveMode, { replace: replaceUrl });
  }

  exportBtn.onclick = () => setMode("export", { triggerAction: true });
  downloadBtn.onclick = () => setMode("download", { triggerAction: true });

  if (triggerAction && (effectiveMode === "export" || effectiveMode === "download")) {
    void triggerNoteAction(effectiveMode);
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

    let mime = "text/plain;charset=utf-8";
    if (currentFileType === "markdown") {
      mime = "text/markdown;charset=utf-8";
    } else if (currentFileType === "csv") {
      mime = "text/csv;charset=utf-8";
    }

    const blob = new Blob([content], { type: mime });
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

  if (errorBannerHideTimerId !== null) {
    window.clearTimeout(errorBannerHideTimerId);
    errorBannerHideTimerId = null;
  }

  banner.textContent = message;
  banner.classList.remove("hidden");

  errorBannerHideTimerId = window.setTimeout(() => {
    banner.classList.add("hidden");
    errorBannerHideTimerId = null;
  }, 6000);
}

function getUploadBannerElement() {
  return document.getElementById("editor-upload-banner");
}

function hideUploadBanner() {
  const banner = getUploadBannerElement();
  if (!banner) return;
  banner.classList.add("hidden");
  banner.textContent = "";
  if (uploadBannerHideTimerId !== null) {
    window.clearTimeout(uploadBannerHideTimerId);
    uploadBannerHideTimerId = null;
  }
}

function renderUploadProgressBar(percent) {
  const slots = 50;
  const value = Number.isFinite(percent) ? percent : 0;
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * slots);
  const hashes = "#".repeat(filled);
  const dashes = "-".repeat(slots - filled);
  return `[${hashes}${dashes}]`;
}

function showUploadBanner(message, percent) {
  const banner = getUploadBannerElement();
  if (!banner) return;
  if (uploadBannerHideTimerId !== null) {
    window.clearTimeout(uploadBannerHideTimerId);
    uploadBannerHideTimerId = null;
  }
  const value = Number.isFinite(percent) ? percent : 0;
  const clamped = Math.max(0, Math.min(100, value));
  const bar = renderUploadProgressBar(clamped);
  banner.textContent = `${message} ${bar} ${clamped}%`;
  banner.classList.remove("hidden");
}

function showUploadBannerFinal(message) {
  const banner = getUploadBannerElement();
  if (!banner) return;
  if (uploadBannerHideTimerId !== null) {
    window.clearTimeout(uploadBannerHideTimerId);
    uploadBannerHideTimerId = null;
  }
  banner.textContent = message;
  banner.classList.remove("hidden");
  uploadBannerHideTimerId = window.setTimeout(() => {
    hideUploadBanner();
  }, 1000);
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

function initializeFancytree(treeRootEl, source) {
  const $tree = window.jQuery(treeRootEl);

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
        "f2",
        "mac+enter",
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
        const normalizedCurrentMode = normalizeMode(currentMode);
        const modeForNavigation =
          normalizedCurrentMode === "export" || normalizedCurrentMode === "download"
            ? "view"
            : normalizedCurrentMode;
        void loadNote(nodePath, { modeOverride: modeForNavigation });
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

  if (!treeInitialized) {
    treeRootEl.textContent = "Loading tree…";
  }

  try {
    const response = await fetch("/api/tree");

    if (!response.ok) {
      throw new Error(`Tree request failed with status ${response.status}`);
    }

    const data = await response.json();
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    treeRootEl.dataset.emptyTree = nodes.length ? "false" : "true";
    const source = mapApiNodesToFancytree(nodes);

    if (!window.jQuery) {
      console.error("jQuery is not available; Fancytree cannot be initialized.");
      treeRootEl.dataset.emptyTree = "false";
      treeRootEl.textContent = "Unable to load notes tree.";
      showError("Unable to load notes tree from the server.");
      return;
    }

    const $tree = window.jQuery(treeRootEl);

    if (typeof $tree.fancytree !== "function") {
      console.error("Fancytree plugin is not available on the jQuery instance.");
      treeRootEl.dataset.emptyTree = "false";
      treeRootEl.textContent = "Unable to load notes tree.";
      showError("Unable to load notes tree from the server.");
      return;
    }

    if (!treeInitialized) {
      treeRootEl.textContent = "";
      initializeFancytree(treeRootEl, source);
    } else {
      const tree = getFancytreeInstance();
      if (tree) {
        try {
          await tree.reload(source);
          syncTreeSelection();
        } catch (reloadError) {
          console.error("Fancytree reload failed; reinitializing tree", reloadError);
          treeRootEl.textContent = "";
          initializeFancytree(treeRootEl, source);
        }
      } else {
        treeRootEl.textContent = "";
        initializeFancytree(treeRootEl, source);
      }
    }
  } catch (error) {
    console.error("/api/tree request failed", error);
    treeRootEl.dataset.emptyTree = "false";
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

    const fileType = typeof data.fileType === "string" ? data.fileType : "markdown";
    currentFileType = fileType;

    if (fileType === "markdown") {
      viewerEl.classList.remove("hidden");
      renderViewerHtml(data.html ?? "");
    } else if (fileType === "csv") {
      viewerEl.classList.remove("hidden");
      renderCsvView(currentNoteContent);
    } else {
      // Generic text files: hide the viewer and rely solely on the Monaco
      // editor for displaying and editing contents.
      viewerEl.classList.add("hidden");
      renderTextFileView("");
    }

    if (typeof modeOverride === "string") {
      currentMode = normalizeMode(modeOverride);
    }

    if (
      monacoEditor &&
      currentMode === "edit" &&
      (currentFileType === "markdown" || currentFileType === "text")
    ) {
      setMonacoLanguageForCurrentFile();
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
    : "No matches found";

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
    empty.textContent = "No matches found. Try a different search term.";
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

function insertMarkdownAtCursor(markdownText) {
  if (!monacoEditor || typeof monaco === "undefined") return;
  const model = monacoEditor.getModel();
  if (!model) return;
  const selection = monacoEditor.getSelection();
  if (!selection) return;

  monacoEditor.executeEdits("paste-image", [
    {
      range: selection,
      text: markdownText,
      forceMoveMarkers: true,
    },
  ]);

  monacoEditor.focus();
}

function getMermaidLocalApiBaseUrlFromSettings() {
  const settings = notebookSettings || {};
  let raw = settings.mermaidLocalApiBaseUrl || DEFAULT_MERMAID_LOCAL_API_BASE_URL;
  raw = String(raw).trim();
  if (!raw) {
    raw = DEFAULT_MERMAID_LOCAL_API_BASE_URL;
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  if (raw.endsWith("/")) {
    raw = raw.slice(0, -1);
  }
  return raw;
}

function buildMermaidLocalApiUrl(path) {
  const base = getMermaidLocalApiBaseUrlFromSettings();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

async function fetchMermaidDiagrams(query) {
  const trimmed = (query || "").trim();
  const url = trimmed
    ? buildMermaidLocalApiUrl(`/api/diagrams/search/${encodeURIComponent(trimmed)}`)
    : buildMermaidLocalApiUrl("/api/diagrams");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mermaid Local API request failed with status ${response.status}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data.items)) {
    return data.items;
  }
  return [];
}

function renderMermaidInsertResults(diagrams, query) {
  const container = document.getElementById("mermaid-results-container");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(diagrams) || !diagrams.length) {
    const empty = document.createElement("div");
    empty.className = "settings-field-description";
    empty.textContent = query
      ? "No diagrams found. Try a different search term."
      : "No diagrams found. Create diagrams in Mermaid Local first.";
    container.appendChild(empty);
    return;
  }

  diagrams.forEach((diagram) => {
    const tile = document.createElement("div");
    tile.className = "mermaid-tile";

    const preview = document.createElement("div");
    preview.className = "mermaid-tile-preview";
    const mermaidEl = document.createElement("div");
    mermaidEl.className = "mermaid";
    if (typeof diagram.content === "string") {
      mermaidEl.textContent = diagram.content;
    }
    preview.appendChild(mermaidEl);

    const details = document.createElement("div");
    details.className = "mermaid-tile-details";

    const titleEl = document.createElement("div");
    titleEl.className = "mermaid-tile-title";
    const titleText = diagram.title || `Diagram ${diagram.id}`;
    titleEl.textContent = titleText;

    const metaEl = document.createElement("div");
    metaEl.className = "mermaid-tile-meta";
    const idText = typeof diagram.id === "number" ? `ID: ${diagram.id}` : "";
    metaEl.textContent = idText;

    const tagsEl = document.createElement("div");
    tagsEl.className = "mermaid-tile-tags";
    if (Array.isArray(diagram.tags) && diagram.tags.length) {
      tagsEl.textContent = `Tags: ${diagram.tags.join(", ")}`;
    }

    const actions = document.createElement("div");
    actions.className = "mermaid-tile-actions";

    const insertRawBtn = document.createElement("button");
    insertRawBtn.type = "button";
    insertRawBtn.className = "settings-btn";
    insertRawBtn.textContent = "Insert raw";
    insertRawBtn.addEventListener("click", () => {
      if (!currentNotePath || currentFileType !== "markdown" || currentMode !== "edit") {
        showError("Mermaid insert is only available when editing a markdown note.");
        return;
      }
      const content = typeof diagram.content === "string" ? diagram.content : "";
      const snippet = `\n\n\"\"\"mermaid\n${content}\n\"\"\"\n`;
      const fenced = snippet.replace(/\"\"\"/g, "```");
      insertMarkdownAtCursor(fenced);
      if (currentMode === "edit") {
        updatePreviewFromEditor();
      }
    });

    const insertLinkedBtn = document.createElement("button");
    insertLinkedBtn.type = "button";
    insertLinkedBtn.className = "settings-btn";
    insertLinkedBtn.textContent = "Insert linked";
    insertLinkedBtn.addEventListener("click", () => {
      if (!currentNotePath || currentFileType !== "markdown" || currentMode !== "edit") {
        showError("Mermaid insert is only available when editing a markdown note.");
        return;
      }
      const id = diagram.id;
      if (typeof id !== "number") {
        showError("Selected diagram is missing a numeric ID.");
        return;
      }
      const title = diagram.title || `Diagram ${id}`;
      const snippetLines = [
        "```mermaid-remote",
        `id: ${id}`,
        `title: ${title}`,
        "```",
        "",
      ];
      const snippet = `\n${snippetLines.join("\n")}`;
      insertMarkdownAtCursor(snippet);
    });

    actions.appendChild(insertRawBtn);
    actions.appendChild(insertLinkedBtn);

    details.appendChild(titleEl);
    details.appendChild(metaEl);
    if (tagsEl.textContent) {
      details.appendChild(tagsEl);
    }
    details.appendChild(actions);

    tile.appendChild(preview);
    tile.appendChild(details);
    container.appendChild(tile);

    if (window.mermaid && typeof window.mermaid.init === "function") {
      try {
        initializeMermaidIfNeeded();
        const result = window.mermaid.init(undefined, [mermaidEl]);
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            console.error("Mermaid rendering failed in insert modal", error);
            const isUnknownDiagramError =
              error &&
              (error.hash === "UnknownDiagramError" ||
                (typeof error.message === "string" &&
                  error.message.indexOf("No diagram type detected") !== -1) ||
                (typeof error.str === "string" &&
                  error.str.indexOf("No diagram type detected") !== -1));

            if (!isUnknownDiagramError && typeof showError === "function") {
              showError(
                buildMermaidErrorMessage(
                  error,
                  "Mermaid rendering failed in Mermaid Local insert modal",
                ),
              );
            }
          });
        }
      } catch (error) {
        console.error("Mermaid rendering failed in insert modal", error);
        const isUnknownDiagramError =
          error &&
          (error.hash === "UnknownDiagramError" ||
            (typeof error.message === "string" &&
              error.message.indexOf("No diagram type detected") !== -1) ||
            (typeof error.str === "string" &&
              error.str.indexOf("No diagram type detected") !== -1));

        if (!isUnknownDiagramError && typeof showError === "function") {
          showError(
            buildMermaidErrorMessage(
              error,
              "Mermaid rendering failed in Mermaid Local insert modal",
            ),
          );
        }
      }
    }
  });
}

async function loadMermaidInsertResults(query) {
  const requestId = ++mermaidLatestRequestId;
  try {
    const diagrams = await fetchMermaidDiagrams(query);
    if (requestId !== mermaidLatestRequestId) {
      return;
    }
    renderMermaidInsertResults(diagrams, query || "");
  } catch (error) {
    if (requestId !== mermaidLatestRequestId) {
      return;
    }
    console.error("Mermaid Local API request failed", error);
    showError("Unable to load diagrams from Mermaid Local.");
    renderMermaidInsertResults([], query || "");
  }
}

function openMermaidInsertModal() {
  const overlay = document.getElementById("mermaid-insert-overlay");
  if (!overlay) return;

  if (!currentNotePath || currentFileType !== "markdown" || currentMode !== "edit") {
    showError("Mermaid insert is only available when editing a markdown note.");
    return;
  }

  const input = document.getElementById("mermaid-search-input");
  const clearBtn = document.getElementById("mermaid-search-clear-btn");

  if (!mermaidInsertInitialized) {
    if (input) {
      input.addEventListener("input", () => {
        const value = input.value || "";
        if (mermaidSearchDebounceTimerId !== null) {
          window.clearTimeout(mermaidSearchDebounceTimerId);
        }
        mermaidSearchDebounceTimerId = window.setTimeout(() => {
          mermaidSearchDebounceTimerId = null;
          void loadMermaidInsertResults(value);
        }, 250);
      });

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          if (mermaidSearchDebounceTimerId !== null) {
            window.clearTimeout(mermaidSearchDebounceTimerId);
            mermaidSearchDebounceTimerId = null;
          }
          void loadMermaidInsertResults(input.value || "");
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (input) {
          input.value = "";
          input.focus();
        }
        if (mermaidSearchDebounceTimerId !== null) {
          window.clearTimeout(mermaidSearchDebounceTimerId);
          mermaidSearchDebounceTimerId = null;
        }
        void loadMermaidInsertResults("");
      });
    }

    mermaidInsertInitialized = true;
  }

  if (input) {
    input.value = "";
    input.focus();
  }

  overlay.classList.remove("hidden");
  void loadMermaidInsertResults("");
}

function closeMermaidInsertModal() {
  const overlay = document.getElementById("mermaid-insert-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
}

function uploadPastedImage(file) {
  if (!file) return;
  if (!currentNotePath) {
    showError("Pasted images require an active note.");
    return;
  }

  const formData = new FormData();
  formData.append("note_path", currentNotePath);
  formData.append("file", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/images/paste");

  showUploadBanner("Uploading image…", 0);

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    showUploadBanner("Uploading image…", percent);
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        const markdown = typeof data.markdown === "string" ? data.markdown : "";
        if (markdown && monacoEditor) {
          insertMarkdownAtCursor(`${markdown}\n`);
          currentNoteContent = monacoEditor.getValue();
          if (currentMode === "edit") {
            updatePreviewFromEditor();
          }
        }
        showUploadBannerFinal("Image upload complete.");
      } catch (error) {
        console.error("Failed to parse paste image response", error);
        showError("Image upload completed, but response could not be parsed.");
        hideUploadBanner();
      }
      return;
    }

    let detail = `Upload failed with status ${xhr.status}`;
    try {
      const parsed = JSON.parse(xhr.responseText);
      if (parsed && parsed.detail) {
        detail = parsed.detail;
      }
    } catch {
      // ignore parse errors
    }

    showError(`Pasted image rejected: ${detail}`);
    hideUploadBanner();
  };

  xhr.onerror = () => {
    showError("Image upload failed due to a network error.");
    hideUploadBanner();
  };

  xhr.send(formData);
}

function handleEditorPaste(event) {
  if (!event || !event.clipboardData) return;
  if (currentMode !== "edit") return;
  if (!currentNotePath) return;

  const items = Array.from(event.clipboardData.items || []);
  const imageFiles = items
    .filter((item) => item && item.kind === "file" && typeof item.type === "string" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file) => !!file);

  if (!imageFiles.length) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (!monacoEditor) {
    showError("Editor is not ready for image paste.");
    return;
  }

  imageFiles.forEach((file) => {
    uploadPastedImage(file);
  });
}

function setupPasteHandling() {
  window.addEventListener(
    "paste",
    (event) => {
      try {
        handleEditorPaste(event);
      } catch (error) {
        console.error("Error handling paste event", error);
      }
    },
    true,
  );
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
      void loadNote(notePath, { modeOverride: "edit" });
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
  const trimmed = (name ?? "").trim();
  if (!trimmed) return trimmed;

  // If the user provided an explicit extension, respect it.
  if (trimmed.includes(".")) {
    return trimmed;
  }

  // No extension provided: default to .md for markdown notes.
  return `${trimmed}.md`;
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

    event.preventDefault();

    const tree = getFancytreeInstance();
    if (!tree || !window.jQuery || !window.jQuery.ui || !window.jQuery.ui.fancytree) {
      return;
    }

    const nodeElem = target.closest(".fancytree-node");
    let node = null;
    if (nodeElem) {
      try {
        node = window.jQuery.ui.fancytree.getNode(nodeElem) || null;
      } catch {
        node = null;
      }
      if (node) {
        node.setActive();
      }
    }

    openTreeContextMenu(event, node);
  });
}

let activeContextMenu = null;

async function handleManageGitignore() {
  const actionRaw = window.prompt("Gitignore action (add or remove)?", "add");
  if (!actionRaw) return;

  const action = actionRaw.trim().toLowerCase();
  if (action !== "add" && action !== "remove") {
    showError("Gitignore action must be 'add' or 'remove'.");
    return;
  }

  const patternRaw = window.prompt(
    `Pattern to ${action} in .gitignore (relative to the notes root)`,
    "*.log",
  );
  if (!patternRaw) return;

  const pattern = patternRaw.trim();
  if (!pattern) {
    showError("Pattern cannot be empty.");
    return;
  }

  const endpoint =
    action === "add"
      ? "/api/versioning/notes/gitignore/add"
      : "/api/versioning/notes/gitignore/remove";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern }),
    });

    if (!response.ok) {
      let detail = `request failed with status ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.detail) {
          detail = data.detail;
        }
      } catch {
        // ignore JSON parse errors
      }
      showError(`Gitignore ${action} failed: ${detail}`);
      return;
    }

    const data = await response.json();
    const flag = action === "add" ? data.added : data.removed;
    const statusText = flag ? "applied" : "no changes were necessary";
    showError(`Gitignore ${action} for '${pattern}': ${statusText}.`);
  } catch (error) {
    console.error("Gitignore management request failed", error);
    showError("Unable to update .gitignore.");
  }
}

function expandAllTreeNodes() {
  const tree = getFancytreeInstance();
  if (!tree) return;
  const root = tree.getRootNode();
  if (!root) return;
  root.visit((n) => {
    if (n.children && n.children.length) {
      n.setExpanded(true);
    }
  });
}

function collapseAllTreeNodes() {
  const tree = getFancytreeInstance();
  if (!tree) return;
  const root = tree.getRootNode();
  if (!root) return;
  root.visit((n) => {
    if (n !== root) {
      n.setExpanded(false);
    }
  });
}

function expandAllSubfolders(node) {
  if (!node) return;
  node.setExpanded(true);
  node.visit((child) => {
    if (child !== node && child.folder) {
      child.setExpanded(true);
    }
  });
}

function collapseAllSubfolders(node) {
  if (!node) return;
  node.visit((child) => {
    if (child !== node && child.folder) {
      child.setExpanded(false);
    }
  });
}

function handleFolderDownload(node) {
  if (!node || !node.data || !node.data.path) {
    showError("Folder download is only available for folders.");
    return;
  }

  const relPath = node.data.path;
  const safePath = toSafePath(relPath);

  const link = document.createElement("a");
  link.href = `/api/folders/${safePath}/download`;
  const parts = relPath.split("/");
  const folderName = parts[parts.length - 1] || "folder";
  link.download = `${folderName}.zip`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function handleFolderGitignoreToggle(node) {
  if (!node || !node.data || !node.data.path) {
    showError("Gitignore toggle is only available for folders.");
    return;
  }

  const folderPath = node.data.path;

  try {
    const response = await fetch("/api/versioning/notes/gitignore/folder-toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath }),
    });

    if (!response.ok) {
      let detail = `request failed with status ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.detail) {
          detail = data.detail;
        }
      } catch {
        // ignore JSON parse errors
      }
      showError(`Folder .gitignore toggle failed: ${detail}`);
      return;
    }

    const data = await response.json();
    const ignored = Boolean(data.ignored);
    const label = folderPath || node.title || "folder";

    if (ignored) {
      showError(`Folder '${label}' is now ignored in .gitignore.`);
    } else {
      showError(`Folder '${label}' is no longer ignored in .gitignore.`);
    }
  } catch (error) {
    console.error("Folder gitignore toggle request failed", error);
    showError("Unable to toggle .gitignore entry for folder.");
  }
}

function downloadFileForNode(node) {
  if (!node || !node.data || !node.data.path) return;
  const type = node.data.type;
  const path = node.data.path;
  if (type === "note") {
    void loadNote(path, {
      modeOverride: "download",
      triggerAction: true,
    });
  } else if (type === "image") {
    const safePath = toSafePath(path);
    const link = document.createElement("a");
    link.href = `/files/${safePath}`;
    const parts = path.split("/");
    link.download = parts[parts.length - 1] || "image";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    showError("Download is only supported for notes and images.");
  }
}

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

  const tree = getFancytreeInstance();
  const hasTree = Boolean(tree);
  const isFolder = node?.data?.type === "folder";
  const isNote = node?.data?.type === "note";
  const isImage = node?.data?.type === "image";
  const hasNode = Boolean(node);

  // Available for all items and within the tree area
  addItem("Expand all", () => {
    expandAllTreeNodes();
  }, !hasTree);

  addItem("Collapse all", () => {
    collapseAllTreeNodes();
  }, !hasTree);

  const globalSep = document.createElement("div");
  globalSep.className = "context-menu-separator";
  menu.appendChild(globalSep);

  if (hasNode && isFolder) {
    addItem("Expand all subfolders", () => {
      expandAllSubfolders(node);
    }, false);

    addItem("Collapse all subfolders", () => {
      collapseAllSubfolders(node);
    }, false);

    addItem("New folder", () => {
      void handleNewFolderClick();
    }, false);

    addItem("New note", () => {
      void handleNewNoteClick();
    }, false);

    addItem("Add to .gitignore (toggle)", () => {
      void handleFolderGitignoreToggle(node);
    }, false);

    addItem("Download folder", () => {
      handleFolderDownload(node);
    }, false);

    const folderSep = document.createElement("div");
    folderSep.className = "context-menu-separator";
    menu.appendChild(folderSep);
  }

  if (hasNode && (isNote || isImage)) {
    addItem(
      "Open in edit mode",
      () => {
        if (!node || !isNote || !node.data?.path) return;
        void loadNote(node.data.path, {
          modeOverride: "edit",
          triggerAction: false,
        });
      },
      !isNote,
    );

    addItem(
      "Export MD as HTML",
      () => {
        if (!node || !isNote || !node.data?.path) return;
        void loadNote(node.data.path, {
          modeOverride: "export",
          triggerAction: true,
        });
      },
      !isNote,
    );

    addItem("Download file", () => {
      downloadFileForNode(node);
    }, false);

    const fileSep = document.createElement("div");
    fileSep.className = "context-menu-separator";
    menu.appendChild(fileSep);
  }

  if (hasNode) {
    addItem("Rename", () => {
      void handleRenameSelectedItem();
    }, !(isFolder || isNote));

    addItem("Delete", () => {
      void handleDeleteSelectedItem();
    }, !(isFolder || isNote));

    const sepNode = document.createElement("div");
    sepNode.className = "context-menu-separator";
    menu.appendChild(sepNode);
  }

  addItem(
    "Manage .gitignore for notes…",
    () => {
      void handleManageGitignore();
    },
    false,
  );

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

  void loadAutoSyncStatus();
}

function isSettingsModalOpen() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return false;

  return !overlay.classList.contains("hidden");
}

function closeSettingsModal() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;

  overlay.classList.add("hidden");
}

function markSettingsCategoryDirty(categoryId) {
  if (!categoryId || typeof document === "undefined") return;

  settingsDirty = true;

  const saveBtn = document.getElementById("settings-footer-save-btn");
  if (saveBtn) {
    saveBtn.disabled = false;
  }

  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;

  const navItem = overlay.querySelector(
    `.settings-nav-item[data-settings-category-id="${categoryId}"]`,
  );
  if (navItem) {
    navItem.classList.add("settings-nav-item-dirty");
  }
}

function resetSettingsDirtyState() {
  settingsDirty = false;
  if (typeof document === "undefined") return;

  const saveBtn = document.getElementById("settings-footer-save-btn");
  if (saveBtn) {
    saveBtn.disabled = false;
  }

  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;

  const navItems = overlay.querySelectorAll(".settings-nav-item");
  navItems.forEach((item) => {
    item.classList.remove("settings-nav-item-dirty");
  });
}

function handleSettingsFieldChanged(target) {
  if (!target || typeof Element === "undefined" || !(target instanceof Element)) {
    return;
  }
  if (suppressSettingsDirtyTracking) return;

  const categoryEl = target.closest("[data-settings-category]");
  if (!categoryEl) return;

  const categoryId = categoryEl.dataset.settingsCategory;
  if (!categoryId) return;

  markSettingsCategoryDirty(categoryId);

  if (target.id === "settings-theme") {
    const value = target.value || "base";
    const nextSettings = { ...(notebookSettings || {}), theme: value };
    applyThemeFromSettings(nextSettings);
  } else if (target.id === "settings-index-page-title") {
    const titleValue = target.value || "";
    applyIndexTitleLive(titleValue);
  }
}

function applyCachedSettingsIfAvailable() {
  const cached = loadSettingsFromLocalCache();
  if (!cached) return;
  notebookSettings = cached;
  applyAllSettings(cached, { resetDirty: true });
}

function setupSettingsModal() {
  const settingsBtn = document.getElementById("settings-btn");
  const overlay = document.getElementById("settings-overlay");
  const closeBtn = document.getElementById("settings-close-btn");
  const footerCloseBtn = document.getElementById("settings-footer-close-btn");
  const saveBtn = document.getElementById("settings-footer-save-btn");
  const exportNotebookBtn = document.getElementById("settings-export-notebook-btn");
  const runCleanupBtn = document.getElementById("settings-run-image-cleanup-btn");
  const autoSyncStatusBtn = document.getElementById(
    "settings-refresh-auto-sync-status-btn",
  );
  const manualCommitPushBtn = document.getElementById(
    "settings-manual-commit-push-btn",
  );
  const manualPullBtn = document.getElementById("settings-manual-pull-btn");

  if (!settingsBtn || !overlay || !closeBtn || !saveBtn) return;

  resetSettingsDirtyState();

  function handleClose() {
    closeSettingsModal();
  }

  settingsBtn.addEventListener("click", () => {
    openSettingsModal();
  });

  closeBtn.addEventListener("click", () => {
    handleClose();
  });

  saveBtn.addEventListener("click", () => {
    void handleSettingsSave();
  });

  if (exportNotebookBtn) {
    exportNotebookBtn.addEventListener("click", () => {
      triggerNotebookExport();
    });
  }

  if (runCleanupBtn) {
    runCleanupBtn.addEventListener("click", () => {
      void handleRunImageCleanup();
    });
  }

  if (autoSyncStatusBtn) {
    autoSyncStatusBtn.addEventListener("click", () => {
      void loadAutoSyncStatus();
    });
  }

  if (manualCommitPushBtn) {
    manualCommitPushBtn.addEventListener("click", () => {
      void runManualCommitAndPush();
    });
  }

  if (manualPullBtn) {
    manualPullBtn.addEventListener("click", () => {
      void runManualPull();
    });
  }

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

  const fields = overlay.querySelectorAll("input, select, textarea");
  fields.forEach((field) => {
    field.addEventListener("input", () => {
      handleSettingsFieldChanged(field);
    });
    field.addEventListener("change", () => {
      handleSettingsFieldChanged(field);
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
    } else if ((event.ctrlKey || event.metaKey) && (event.key === "i" || event.key === "I")) {
      event.preventDefault();
      openMermaidInsertModal();
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
  applyCachedSettingsIfAvailable();
  void loadNotebookSettings();
  loadTree();
  setupTreeSelection();
  setupNewItemButtons();
  setupModeToggle();
  initMonacoEditor();
  setupPasteHandling();
  setupSettingsModal();
  setupSearch();
  initializeNavigationFromUrl();
  setupViewerScrollSync();
  const mermaidOverlay = document.getElementById("mermaid-insert-overlay");
  const mermaidCloseBtn = document.getElementById("mermaid-insert-close-btn");
  const mermaidCloseFooterBtn = document.getElementById(
    "mermaid-insert-close-footer-btn",
  );
  if (mermaidOverlay) {
    mermaidOverlay.addEventListener("click", (event) => {
      if (event.target === mermaidOverlay) {
        closeMermaidInsertModal();
      }
    });
  }
  if (mermaidCloseBtn) {
    mermaidCloseBtn.addEventListener("click", () => {
      closeMermaidInsertModal();
    });
  }
  if (mermaidCloseFooterBtn) {
    mermaidCloseFooterBtn.addEventListener("click", () => {
      closeMermaidInsertModal();
    });
  }
});

window.addEventListener("focus", () => {
  void loadTree();
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
