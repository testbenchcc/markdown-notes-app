(function () {
  const editorEl = document.getElementById("editor");
  const editorWrapperEl = document.getElementById("editor-wrapper");

  if (!editorEl || !editorWrapperEl) {
    return;
  }

  const overlayContainer = document.createElement("div");
  overlayContainer.id = "editor-highlighter";
  overlayContainer.className = "editor-highlighter";

  const overlayContent = document.createElement("div");
  overlayContent.className = "editor-highlighter-content";

  const visualWrapper = document.createElement("div");
  visualWrapper.className = "editor-visual-wrapper";

  overlayContainer.appendChild(overlayContent);

  editorWrapperEl.replaceChild(visualWrapper, editorEl);
  visualWrapper.appendChild(overlayContainer);
  visualWrapper.appendChild(editorEl);

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function highlightLinksAndEscape(text) {
    if (!text) {
      return "";
    }

    const re = /(!?\[[^\]]*\]\([^\)]+\))/g;
    let lastIndex = 0;
    let result = "";
    let match;

    while ((match = re.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before) {
        result += escapeHtml(before);
      }
      const token = match[0];
      result += `<span class="tok-link">${escapeHtml(token)}</span>`;
      lastIndex = match.index + token.length;
    }

    const after = text.slice(lastIndex);
    if (after) {
      result += escapeHtml(after);
    }

    if (!result) {
      result = escapeHtml(text);
    }

    return result;
  }

  function highlightInlineCode(text) {
    if (!text) {
      return "";
    }

    const re = /`([^`]+)`/g;
    let lastIndex = 0;
    let result = "";
    let match;

    while ((match = re.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before) {
        result += highlightLinksAndEscape(before);
      }
      const codeWithDelimiters = match[0];
      result += `<span class="tok-inline-code">${escapeHtml(codeWithDelimiters)}</span>`;
      lastIndex = match.index + match[0].length;
    }

    const after = text.slice(lastIndex);
    if (after) {
      result += highlightLinksAndEscape(after);
    }

    if (!result) {
      result = highlightLinksAndEscape(text);
    }

    return result;
  }

  function highlightCodeTokens(line, fenceLang) {
    if (!line) {
      return "";
    }

    const trimmed = line.trim();
    // If the line looks like a single filename / token (letters, digits, dot, dash, underscore),
    // skip token-level highlighting so we don't introduce confusing markup into things like CSV names.
    if (/^[A-Za-z0-9._-]+$/.test(trimmed)) {
      return escapeHtml(line);
    }

    let escaped = escapeHtml(line);

    // Strings
    escaped = escaped.replace(/(".*?"|'.*?')/g, (m) => {
      return `<span class="tok-code-str">${m}</span>`;
    });

    // Numbers
    escaped = escaped.replace(/\b(\d+(?:\.\d+)?|\.\d+)\b/g, (m) => {
      return `<span class="tok-code-num">${m}</span>`;
    });

    // Keywords (generic set across common languages)
    const kwRegex =
      /\b(async|await|break|case|catch|class|const|continue|def|elif|else|enum|export|extends|for|from|function|if|import|in|interface|let|match|new|return|struct|switch|try|while|with|yield)\b/g;
    escaped = escaped.replace(kwRegex, (m) => {
      return `<span class="tok-code-kw">${m}</span>`;
    });

    // Comments (whole rest of line)
    escaped = escaped.replace(/(^\s*\/\/.*$)/g, (m) => {
      return `<span class="tok-code-comment">${m}</span>`;
    });
    escaped = escaped.replace(/(^\s*#.*$)/g, (m) => {
      return `<span class="tok-code-comment">${m}</span>`;
    });

    return escaped;
  }

  function highlightMarkdown(text) {
    if (!text) {
      return "&nbsp;";
    }

    const lines = text.split("\n");
    const highlighted = [];

    let inFence = false;
    let fenceLang = "";

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const rawLine = line;
      let htmlLine = escapeHtml(line);

      const fenceMatch = rawLine.match(/^```(.*)$/);
      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceLang = (fenceMatch[1] || "").trim().toLowerCase();
          htmlLine = `<span class="tok-fence">${escapeHtml(rawLine)}</span>`;
        } else {
          inFence = false;
          fenceLang = "";
          htmlLine = `<span class="tok-fence">${escapeHtml(rawLine)}</span>`;
        }
        highlighted.push(htmlLine || "&nbsp;");
        continue;
      }

      if (inFence) {
        const tokenized = highlightCodeTokens(rawLine, fenceLang);
        htmlLine = `<span class="tok-code-line">${tokenized}</span>`;
        highlighted.push(htmlLine || "&nbsp;");
        continue;
      }

      const headingMatch = rawLine.match(/^(#{1,6})\s+.*$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingHtml = highlightInlineCode(rawLine);
        htmlLine = `<span class="tok-heading tok-h${level}">${headingHtml}</span>`;
        highlighted.push(htmlLine || "&nbsp;");
        continue;
      }

      const taskMatch = rawLine.match(/^(\s*)- \[( |x|X)\] (.*)$/);
      if (taskMatch) {
        const indent = taskMatch[1] || "";
        const box = taskMatch[2] || " ";
        const body = taskMatch[3] || "";
        const bodyHtml = highlightInlineCode(body);
        htmlLine = `${escapeHtml(indent)}<span class="tok-bullet">-</span> <span class="tok-task-box">[${escapeHtml(
          box
        )}]</span> <span class="tok-task-text">${bodyHtml}</span>`;
        highlighted.push(htmlLine || "&nbsp;");
        continue;
      }

      const bulletMatch = rawLine.match(/^(\s*)- (.*)$/);
      if (bulletMatch) {
        const indent = bulletMatch[1] || "";
        const body = bulletMatch[2] || "";
        const bodyHtml = highlightInlineCode(body);
        htmlLine = `${escapeHtml(indent)}<span class="tok-bullet">-</span> <span class="tok-bullet-text">${bodyHtml}</span>`;
        highlighted.push(htmlLine || "&nbsp;");
        continue;
      }

      htmlLine = highlightInlineCode(rawLine);
      highlighted.push(htmlLine || "&nbsp;");
    }

    return highlighted.join("<br>");
  }

  function syncOverlayScroll() {
    overlayContainer.scrollTop = editorEl.scrollTop;
    overlayContainer.scrollLeft = editorEl.scrollLeft;
  }

  function syncOverlaySize() {
    const style = window.getComputedStyle(editorEl);
    overlayContainer.style.fontFamily = style.fontFamily;
    overlayContainer.style.fontSize = style.fontSize;
    overlayContainer.style.lineHeight = style.lineHeight;
    overlayContainer.style.padding = style.padding;
  }

  function refreshOverlay() {
    const value = editorEl.value || "";
    overlayContent.innerHTML = highlightMarkdown(value);
    syncOverlayScroll();
  }

  editorEl.addEventListener("input", () => {
    refreshOverlay();
  });

  editorEl.addEventListener("scroll", () => {
    syncOverlayScroll();
  });

  window.addEventListener("resize", () => {
    syncOverlaySize();
  });

  syncOverlaySize();
  refreshOverlay();

  window.markdownEditorHighlighter = {
    refresh: refreshOverlay,
    syncScroll: syncOverlayScroll,
  };
})();
