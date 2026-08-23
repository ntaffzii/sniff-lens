// ============================================================================
// Network Image Sniffer & AI Toolkit (SniffLens) - Popup Controller (v2.6.3)
// ============================================================================

async function initPopup() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Retrieve captured items count for active tab
    const key = "captured-" + tab.id;
    const store = await chrome.storage.session.get(key);
    const items = store[key] || [];

    const countEl = document.getElementById("count-val");
    const statusEl = document.getElementById("status-val");

    if (countEl) countEl.textContent = items.length;
    if (statusEl) statusEl.textContent = items.length > 0 ? "Active" : "Ready";

    // Retrieve active tab-scoped settings
    const tabKey = "tab_settings_" + tab.id;
    const tabStore = await chrome.storage.session.get(tabKey);
    let settings = tabStore?.[tabKey];

    if (!settings) {
      const globalStore = await chrome.storage.local.get("global_sniffer_settings");
      settings = globalStore?.global_sniffer_settings || { subfolder: "captured", filenamePattern: "{prefix}_{num3}" };
    }

    const folderEl = document.getElementById("popup-folder-val");
    const patternEl = document.getElementById("popup-pattern-val");

    if (folderEl) folderEl.textContent = settings.subfolder || "Downloads";
    if (patternEl) patternEl.textContent = settings.filenamePattern || "{orig}";

    // Open Side Panel button
    document.getElementById("open-panel-btn")?.addEventListener("click", async () => {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    });
  } catch (err) {
    console.error("[Sniffer] Popup initialization error:", err);
  }
}

initPopup();
