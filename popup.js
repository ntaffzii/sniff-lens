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

    // Master Sniffing Switch Logic
    const masterCb = document.getElementById("master-sniff-cb");
    const liveBadge = document.getElementById("popup-live-badge");
    const liveText = document.getElementById("popup-live-text");
    const switchSub = document.getElementById("switch-subtitle");

    function updateSniffUI(enabled) {
      if (masterCb) masterCb.checked = enabled;
      if (liveBadge) {
        if (enabled) {
          liveBadge.classList.remove("paused");
          if (liveText) liveText.textContent = "ACTIVE";
        } else {
          liveBadge.classList.add("paused");
          if (liveText) liveText.textContent = "PAUSED";
        }
      }
      if (switchSub) {
        if (enabled) {
          switchSub.textContent = "Active (O(1) Live)";
          switchSub.style.color = "#34d399";
        } else {
          switchSub.textContent = "Paused (0% Resource)";
          switchSub.style.color = "#f87171";
        }
      }
    }

    // Get initial state
    chrome.runtime.sendMessage({ type: "GET_SNIFFING_STATE", tabId: tab.id }, (res) => {
      updateSniffUI(res?.enabled !== false);
    });

    // Toggle listener
    masterCb?.addEventListener("change", () => {
      const newState = masterCb.checked;
      updateSniffUI(newState);
      chrome.runtime.sendMessage({
        type: "SET_SNIFFING_STATE",
        enabled: newState,
        tabId: tab.id,
        isGlobal: true
      });
    });

    liveBadge?.addEventListener("click", () => {
      if (masterCb) {
        masterCb.checked = !masterCb.checked;
        masterCb.dispatchEvent(new Event("change"));
      }
    });

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

