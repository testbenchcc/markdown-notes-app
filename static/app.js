async function updateHealthStatus() {
  const statusEl = document.getElementById("app-status");

  if (!statusEl) return;

  statusEl.textContent = "Checking health…";

  try {
    const response = await fetch("/health");

    if (!response.ok) {
      throw new Error(`Health check failed with status ${response.status}`);
    }

    const data = await response.json();

    const statusText = data.status ?? "unknown";
    const versionText = data.version ? `v${data.version}` : "";

    statusEl.dataset.status = statusText;
    statusEl.textContent = `${statusText} ${versionText}`.trim();
  } catch (error) {
    console.error("/health request failed", error);
    statusEl.dataset.status = "error";
    statusEl.textContent = "error";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  updateHealthStatus();
});
