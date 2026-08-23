// ============================================================================
// Network Image Sniffer & AI Toolkit (SniffLens) - Side Panel Controller (v2.6.3)
// High-Performance Multi-Tab & Per-Site Isolation Engine
// ============================================================================

let currentTabId = null;
let currentTabDomain = "website";
let currentTabTitle = "Webpage";
let items = [];
let selectedUrls = new Set();
let currentLightboxIndex = -1;
let filteredItemsCache = [];

const DEFAULT_GLOBAL_SETTINGS = {
  subfolder: "captured",
  filenamePattern: "{prefix}_{num3}",
  prefix: "image",
  startNumber: 1,
  captureImages: true,
  captureVideos: true,
  dedupEnabled: true,
  saveAsPrompt: false
};

// Active Tab-Scoped Settings
let userSettings = { ...DEFAULT_GLOBAL_SETTINGS };

// Debounce helper for high-performance input events (O(1) overhead)
function debounce(fn, waitMs = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

// Retrieve active tab info
async function getActiveTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      currentTabId = tab.id;
    }
    if (tab?.url) {
      try {
        const u = new URL(tab.url);
        currentTabDomain = u.hostname.replace(/^www\./, "").split(".")[0] || "web";
        currentTabTitle = tab.title || currentTabDomain;
      } catch {}
    }
    return currentTabId;
  } catch {
    return null;
  }
}

/**
 * Load tab-scoped settings with O(1) session storage lookup
 */
async function loadUserSettings(tabId = null) {
  const targetTabId = tabId || currentTabId;
  if (!targetTabId) return;

  try {
    const tabKey = "tab_settings_" + targetTabId;
    const tabStore = await chrome.storage.session.get(tabKey);

    if (tabStore && tabStore[tabKey]) {
      userSettings = { ...DEFAULT_GLOBAL_SETTINGS, ...tabStore[tabKey] };
    } else {
      const globalStore = await chrome.storage.local.get("global_sniffer_settings");
      const globalBase = globalStore?.global_sniffer_settings || DEFAULT_GLOBAL_SETTINGS;

      userSettings = {
        ...globalBase,
        subfolder: globalBase.subfolder || `captured/${getTodayDateString()}-${currentTabDomain}`,
        prefix: globalBase.prefix || `image-${currentTabDomain}`,
        startNumber: 1
      };

      await chrome.storage.session.set({ [tabKey]: userSettings });
    }
  } catch (err) {
    console.error("[Sniffer] Failed to load tab settings:", err);
  }

  updateSettingsSummaryUI();
}

/**
 * Save settings to Tab-Scoped storage & optional global defaults
 */
async function saveUserSettings(saveAsGlobal = false) {
  if (!currentTabId) return;
  const tabKey = "tab_settings_" + currentTabId;

  await chrome.storage.session.set({ [tabKey]: userSettings });

  if (saveAsGlobal) {
    await chrome.storage.local.set({ global_sniffer_settings: userSettings });
  }

  updateSettingsSummaryUI();
}

// Update header summary labels
function updateSettingsSummaryUI() {
  const folderLbl = document.getElementById("active-folder-label");
  const patternLbl = document.getElementById("active-pattern-label");
  const badge = document.getElementById("active-tab-badge");

  if (folderLbl) folderLbl.textContent = userSettings.subfolder || "Downloads";
  if (patternLbl) patternLbl.textContent = userSettings.filenamePattern || "{orig}";
  if (badge) {
    badge.textContent = `📌 ${currentTabDomain}`;
    badge.title = `Active tab profile: ${currentTabTitle} (ID: ${currentTabId})`;
  }
}

// Load captured media items for active tab
async function loadItems() {
  if (currentTabId == null) {
    currentTabId = await getActiveTabInfo();
  }
  if (currentTabId == null) return;

  const key = "captured-" + currentTabId;
  const store = await chrome.storage.session.get(key);
  items = store[key] || [];
  render();
}

// Format human-readable file sizes
function humanSize(bytes) {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Get current date string YYYY-MM-DD
function getTodayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Extract clean file extension from MIME or URL
function getFileExtension(url, mime) {
  try {
    const u = new URL(url);
    const fname = decodeURIComponent(u.pathname.split("/").pop() || "");
    const match = fname.match(/\.([a-z0-9]{2,4})$/i);
    if (match) return match[1].toLowerCase();
  } catch {}
  
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  if (m.includes("gif")) return "gif";
  if (m.includes("video") || m.includes("mp4")) return "mp4";
  return "jpg";
}

// Extract base filename from URL
function getOriginalBasename(url) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname.split("/").pop() || "image");
    name = name.split("?")[0].replace(/\.[a-z0-9]{2,4}$/i, "");
    return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "image";
  } catch {
    return "image";
  }
}

// ============================================================================
// Single Source of Truth for Sequential Filename Generation
// ============================================================================
function generateFilename(item, index = 1, total = 1, customPattern = null, customPrefix = null, customStartNum = null) {
  const pattern = customPattern || userSettings.filenamePattern || "{prefix}_{num3}";
  const prefix = customPrefix != null ? customPrefix : (userSettings.prefix || "image");
  const startNum = customStartNum != null ? customStartNum : (parseInt(userSettings.startNumber, 10) || 1);
  const actualNumber = startNum + (index - 1);

  const ext = getFileExtension(item.url, item.contentType);
  const origName = getOriginalBasename(item.url);
  const dateStr = getTodayDateString();
  const domainStr = currentTabDomain || "web";

  // Zero-padded sequence numbers
  const numPad3 = String(actualNumber).padStart(3, "0");
  const numPad2 = String(actualNumber).padStart(2, "0");
  const numRaw = String(actualNumber);

  let resultName = pattern
    .replace(/\{prefix\}/gi, prefix)
    .replace(/\{num3\}/gi, numPad3)
    .replace(/\{num2\}/gi, numPad2)
    .replace(/\{num\}/gi, numRaw)
    .replace(/\{orig\}/gi, origName)
    .replace(/\{date\}/gi, dateStr)
    .replace(/\{domain\}/gi, domainStr);

  // Sanitize illegal characters
  resultName = resultName.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

  if (!resultName.toLowerCase().endsWith("." + ext)) {
    resultName += "." + ext;
  }

  return resultName;
}

// Format short badge text for media type
function formatBadgeText(item) {
  if (item.resourceType === "media") return "VIDEO";
  const mime = (item.contentType || "").toLowerCase();
  if (mime.includes("webp")) return "WEBP";
  if (mime.includes("png")) return "PNG";
  if (mime.includes("svg")) return "SVG";
  if (mime.includes("gif")) return "GIF";
  return "JPG";
}

// Filter dataset based on Search, Type, and Size (O(N))
function getFiltered() {
  const searchInput = document.getElementById("search-input");
  const filterTypeEl = document.getElementById("filter-type");
  const filterSizeEl = document.getElementById("filter-size");

  const searchTerm = (searchInput?.value || "").trim().toLowerCase();
  const filterType = filterTypeEl?.value || "all";
  const minSize = parseInt(filterSizeEl?.value || "0", 10) || 0;

  return items.filter((item) => {
    if (filterType !== "all" && item.resourceType !== filterType) return false;
    if (minSize > 0 && (!item.size || item.size < minSize)) return false;
    if (searchTerm && !item.url.toLowerCase().includes(searchTerm)) return false;
    return true;
  });
}

// ============================================================================
// High-Performance Grid Rendering (DocumentFragment Batch Insertion: O(1) Reflow)
// ============================================================================
function render() {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const statCount = document.getElementById("stat-count");
  if (!grid || !empty || !statCount) return;

  const filtered = getFiltered();
  filteredItemsCache = filtered;

  statCount.textContent = `${filtered.length} items`;
  empty.style.display = filtered.length ? "none" : "block";

  updateSelectAllCheckbox(filtered);

  // DocumentFragment prevents O(N) layout thrashing, achieving O(1) single-pass reflow
  const fragment = document.createDocumentFragment();

  filtered.forEach((item, index) => {
    const card = document.createElement("div");
    const isChecked = selectedUrls.has(item.url);
    card.className = "item-card" + (isChecked ? " is-selected" : "");

    // Checkbox overlay
    const cbBox = document.createElement("div");
    cbBox.className = "checkbox-overlay";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isChecked;
    cb.onclick = (e) => {
      e.stopPropagation();
      toggleSelect(item.url, cb.checked);
    };
    cbBox.appendChild(cb);

    // Quick download button
    const quickDl = document.createElement("button");
    quickDl.className = "quick-download-btn";
    quickDl.innerHTML = "💾";
    quickDl.title = "Download this image";
    quickDl.onclick = (e) => {
      e.stopPropagation();
      downloadSingleItem(item, index + 1);
    };

    // Thumbnail Container
    const thumbContainer = document.createElement("div");
    thumbContainer.className = "thumb-container";
    thumbContainer.onclick = () => openLightbox(index);

    // Dimensions badge
    const dimBadge = document.createElement("span");
    dimBadge.className = "dim-badge";
    dimBadge.textContent = item.width && item.height ? `${item.width}×${item.height}` : "...";

    if (item.resourceType === "media") {
      const videoEl = document.createElement("video");
      videoEl.className = "thumb-img";
      videoEl.src = item.url;
      videoEl.muted = true;
      videoEl.preload = "metadata";
      videoEl.onloadedmetadata = () => {
        if (videoEl.videoWidth && videoEl.videoHeight) {
          item.width = videoEl.videoWidth;
          item.height = videoEl.videoHeight;
          dimBadge.textContent = `${videoEl.videoWidth}×${videoEl.videoHeight}`;
        }
      };
      videoEl.onerror = () => {
        dimBadge.textContent = "Media";
      };
      thumbContainer.appendChild(videoEl);
    } else {
      const img = document.createElement("img");
      img.className = "thumb-img";
      img.src = item.url;
      img.loading = "lazy";
      img.alt = generateFilename(item, index + 1, filtered.length);

      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          item.width = img.naturalWidth;
          item.height = img.naturalHeight;
          dimBadge.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
        }
      };
      img.onerror = () => {
        img.style.opacity = "0.2";
        dimBadge.textContent = "Error";
      };
      thumbContainer.appendChild(img);
    }

    // Type badge
    const typeBadge = document.createElement("span");
    typeBadge.className = "media-badge";
    typeBadge.textContent = formatBadgeText(item);

    thumbContainer.appendChild(typeBadge);
    thumbContainer.appendChild(dimBadge);

    // Footer Info
    const footer = document.createElement("div");
    footer.className = "card-footer";
    const fname = generateFilename(item, index + 1, filtered.length);
    footer.innerHTML = `
      <span class="filename-txt" title="${fname}">${fname}</span>
      <span class="filesize-txt">${humanSize(item.size)}</span>
    `;

    card.appendChild(cbBox);
    card.appendChild(quickDl);
    card.appendChild(thumbContainer);
    card.appendChild(footer);
    fragment.appendChild(card);
  });

  grid.innerHTML = "";
  grid.appendChild(fragment);

  updateSelectedCountUI();
}

// Card Selection Toggle (O(1) Set mutation)
function toggleSelect(url, isChecked) {
  if (isChecked) selectedUrls.add(url);
  else selectedUrls.delete(url);

  updateSelectedCountUI();
  updateSelectAllCheckbox(filteredItemsCache);

  document.querySelectorAll(".item-card").forEach((card) => {
    const cb = card.querySelector("input[type=checkbox]");
    if (cb && cb.checked !== card.classList.contains("is-selected")) {
      card.classList.toggle("is-selected", cb.checked);
    }
  });
}

// Update selected count indicator
function updateSelectedCountUI() {
  const count = selectedUrls.size;
  const countEl = document.getElementById("selected-count");
  const dlBtn = document.getElementById("dl-selected-btn");
  if (countEl) countEl.textContent = count;
  if (dlBtn) dlBtn.disabled = count === 0;
}

// Single-pass O(N) Select-All state updater
function updateSelectAllCheckbox(filteredList) {
  const selectAllCb = document.getElementById("select-all-cb");
  if (!selectAllCb) return;
  const len = filteredList.length;
  if (!len) {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = false;
    return;
  }

  let selectedCount = 0;
  for (let i = 0; i < len; i++) {
    if (selectedUrls.has(filteredList[i].url)) {
      selectedCount++;
    }
  }

  selectAllCb.checked = selectedCount === len;
  selectAllCb.indeterminate = selectedCount > 0 && selectedCount < len;
}

// Single Item Download Trigger
function downloadSingleItem(item, index = 1, customFilename = null) {
  const filename = customFilename || generateFilename(item, index, filteredItemsCache.length);
  const folder = userSettings.subfolder || "captured";

  chrome.runtime.sendMessage({
    type: "DOWNLOAD_IMAGE",
    url: item.url,
    contentType: item.contentType,
    folder: folder,
    filename: filename,
    saveAs: userSettings.saveAsPrompt
  });

  showToast(`💾 Downloading: ${filename}`);
}

// ============================================================================
// Lightbox Modal (Fullscreen Preview & Single Rename)
// ============================================================================
const modal = document.getElementById("lightbox-modal");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxRenameInput = document.getElementById("lightbox-rename-input");
const lightboxPathPreview = document.getElementById("lightbox-path-preview");
const lightboxDim = document.getElementById("lightbox-dim");
const lightboxSize = document.getElementById("lightbox-size");
const lightboxMime = document.getElementById("lightbox-mime");
const lightboxIndexBadge = document.getElementById("lightbox-index-badge");

function openLightbox(index) {
  if (index < 0 || index >= filteredItemsCache.length) return;
  currentLightboxIndex = index;
  updateLightboxContent();
  if (modal) {
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }
}

function closeLightbox() {
  if (modal) {
    modal.classList.remove("active");
    currentLightboxIndex = -1;
    document.body.style.overflow = "";
    const wrapper = document.querySelector(".lightbox-img-wrapper");
    if (wrapper) {
      const vid = wrapper.querySelector("video");
      if (vid) {
        vid.pause();
        vid.src = "";
      }
    }
  }
}

function updateLightboxContent() {
  const item = filteredItemsCache[currentLightboxIndex];
  if (!item) return;

  const defaultFilename = generateFilename(item, currentLightboxIndex + 1, filteredItemsCache.length);
  if (lightboxRenameInput) lightboxRenameInput.value = defaultFilename;
  updateLightboxPathPreview(defaultFilename);

  const wrapper = document.querySelector(".lightbox-img-wrapper");
  if (wrapper) {
    wrapper.innerHTML = "";
    if (item.resourceType === "media") {
      const vid = document.createElement("video");
      vid.id = "lightbox-video";
      vid.src = item.url;
      vid.controls = true;
      vid.autoplay = true;
      vid.muted = true;
      vid.style.maxWidth = "100%";
      vid.style.maxHeight = "100%";
      vid.style.borderRadius = "6px";
      vid.onloadedmetadata = () => {
        if (vid.videoWidth && vid.videoHeight) {
          item.width = vid.videoWidth;
          item.height = vid.videoHeight;
          if (lightboxDim) lightboxDim.textContent = `${vid.videoWidth} × ${vid.videoHeight}`;
        }
      };
      wrapper.appendChild(vid);
    } else {
      const img = document.createElement("img");
      img.id = "lightbox-img";
      img.src = item.url;
      img.alt = "Full preview";
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          item.width = img.naturalWidth;
          item.height = img.naturalHeight;
          if (lightboxDim) lightboxDim.textContent = `${item.width} × ${item.height}`;
        }
      };
      wrapper.appendChild(img);
    }
  }

  if (lightboxSize) lightboxSize.textContent = humanSize(item.size);
  if (lightboxMime) lightboxMime.textContent = item.contentType || "image/jpeg";
  if (lightboxIndexBadge) lightboxIndexBadge.textContent = `${currentLightboxIndex + 1} / ${filteredItemsCache.length}`;

  if (lightboxDim) {
    lightboxDim.textContent = (item.width && item.height)
      ? `${item.width} × ${item.height}`
      : "Reading dimensions...";
  }
}

function updateLightboxPathPreview(filename) {
  if (!lightboxPathPreview) return;
  const folder = userSettings.subfolder ? `${userSettings.subfolder}/` : "";
  lightboxPathPreview.textContent = `📁 Downloads/${folder}${filename}`;
}

lightboxRenameInput?.addEventListener("input", (e) => {
  updateLightboxPathPreview(e.target.value);
});

function nextLightbox() {
  if (!filteredItemsCache.length) return;
  currentLightboxIndex = (currentLightboxIndex + 1) % filteredItemsCache.length;
  updateLightboxContent();
}

function prevLightbox() {
  if (!filteredItemsCache.length) return;
  currentLightboxIndex = (currentLightboxIndex - 1 + filteredItemsCache.length) % filteredItemsCache.length;
  updateLightboxContent();
}

document.getElementById("lightbox-close")?.addEventListener("click", closeLightbox);
document.getElementById("lightbox-next")?.addEventListener("click", (e) => { e.stopPropagation(); nextLightbox(); });
document.getElementById("lightbox-prev")?.addEventListener("click", (e) => { e.stopPropagation(); prevLightbox(); });

if (modal) {
  modal.onclick = (e) => {
    if (e.target === modal || e.target.classList.contains("lightbox-body") || e.target.classList.contains("lightbox-img-wrapper")) {
      closeLightbox();
    }
  };
}

// Download single item with custom renamed filename from Lightbox
document.getElementById("lightbox-dl-btn")?.addEventListener("click", () => {
  const item = filteredItemsCache[currentLightboxIndex];
  if (!item) return;
  const customName = lightboxRenameInput?.value.trim() || generateFilename(item, currentLightboxIndex + 1);
  downloadSingleItem(item, currentLightboxIndex + 1, customName);
});

document.getElementById("lightbox-copy-btn")?.addEventListener("click", async () => {
  const item = filteredItemsCache[currentLightboxIndex];
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.url);
    showToast("📋 URL copied to clipboard");
  } catch {
    showToast("❌ Failed to copy URL");
  }
});

document.getElementById("lightbox-open-tab-btn")?.addEventListener("click", () => {
  const item = filteredItemsCache[currentLightboxIndex];
  if (item) chrome.tabs.create({ url: item.url });
});

// Keyboard Navigation
document.addEventListener("keydown", (e) => {
  if (e.target === lightboxRenameInput || e.target.tagName === "INPUT") {
    if (e.key === "Escape") {
      closeLightbox();
      closeSettingsModal();
    }
    return;
  }
  if (modal?.classList.contains("active")) {
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowRight") nextLightbox();
    if (e.key === "ArrowLeft") prevLightbox();
  }
});

// ============================================================================
// Settings Modal (Custom Subfolder & Filename Pattern Configuration)
// ============================================================================
const settingsModal = document.getElementById("settings-modal");
const folderInput = document.getElementById("setting-folder-input");
const patternInput = document.getElementById("setting-pattern-input");
const prefixInput = document.getElementById("setting-prefix-input");
const startNumInput = document.getElementById("setting-start-num-input");
const capImagesCb = document.getElementById("setting-cap-images-cb");
const capVideosCb = document.getElementById("setting-cap-videos-cb");
const dedupCb = document.getElementById("setting-dedup-cb");
const saveAsCb = document.getElementById("setting-saveas-cb");
const saveGlobalCb = document.getElementById("setting-save-global-cb");
const settingsTabName = document.getElementById("settings-tab-name");
const previewBox = document.getElementById("setting-preview-box");

function openSettingsModal() {
  if (folderInput) folderInput.value = userSettings.subfolder || "captured";
  if (patternInput) patternInput.value = userSettings.filenamePattern || "{prefix}_{num3}";
  if (prefixInput) prefixInput.value = userSettings.prefix || "image";
  if (startNumInput) startNumInput.value = userSettings.startNumber || 1;
  if (capImagesCb) capImagesCb.checked = userSettings.captureImages !== false;
  if (capVideosCb) capVideosCb.checked = userSettings.captureVideos !== false;
  if (dedupCb) dedupCb.checked = userSettings.dedupEnabled !== false;
  if (saveAsCb) saveAsCb.checked = Boolean(userSettings.saveAsPrompt);
  if (saveGlobalCb) saveGlobalCb.checked = false;

  if (settingsTabName) {
    settingsTabName.textContent = `${currentTabDomain} (Tab ${currentTabId || ""})`;
    settingsTabName.title = currentTabTitle;
  }

  updateSettingsLivePreview();
  if (settingsModal) settingsModal.classList.add("active");
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.remove("active");
}

function updateSettingsLivePreview() {
  if (!previewBox) return;
  const folder = folderInput?.value.trim() || "Downloads";
  const pattern = patternInput?.value.trim() || "{prefix}_{num3}";
  const prefix = prefixInput?.value.trim() || "image";
  const startNum = parseInt(startNumInput?.value || "1", 10) || 1;
  
  const dummyItem = { url: "https://example.com/demo.jpg", contentType: "image/jpeg" };
  const ex1 = generateFilename(dummyItem, 1, 2, pattern, prefix, startNum);
  const ex2 = generateFilename(dummyItem, 2, 2, pattern, prefix, startNum);

  previewBox.innerHTML = `
    Preview: <b>${ex1}</b>, <b>${ex2}</b><br/>
    Destination: <b>Downloads/${folder ? folder + "/" : ""}${ex1}</b>
  `;
}

// Preset Buttons in Settings Modal
document.getElementById("preset-folder-domain")?.addEventListener("click", () => {
  if (folderInput) folderInput.value = `captured/${currentTabDomain}`;
  updateSettingsLivePreview();
});
document.getElementById("preset-folder-date")?.addEventListener("click", () => {
  if (folderInput) folderInput.value = `captured/${getTodayDateString()}-${currentTabDomain}`;
  updateSettingsLivePreview();
});
document.getElementById("preset-folder-default")?.addEventListener("click", () => {
  if (folderInput) folderInput.value = "captured";
  updateSettingsLivePreview();
});

document.getElementById("preset-name-seq")?.addEventListener("click", () => {
  if (patternInput) patternInput.value = "{prefix}_{num3}";
  updateSettingsLivePreview();
});
document.getElementById("preset-name-domain")?.addEventListener("click", () => {
  if (patternInput) patternInput.value = "{domain}_{num3}";
  updateSettingsLivePreview();
});
document.getElementById("preset-name-orig")?.addEventListener("click", () => {
  if (patternInput) patternInput.value = "{orig}";
  updateSettingsLivePreview();
});

folderInput?.addEventListener("input", updateSettingsLivePreview);
patternInput?.addEventListener("input", updateSettingsLivePreview);
prefixInput?.addEventListener("input", updateSettingsLivePreview);
startNumInput?.addEventListener("input", updateSettingsLivePreview);

// Save Settings Button
document.getElementById("settings-save-btn")?.addEventListener("click", async () => {
  userSettings.subfolder = folderInput?.value.trim() || "captured";
  userSettings.filenamePattern = patternInput?.value.trim() || "{prefix}_{num3}";
  userSettings.prefix = prefixInput?.value.trim() || "image";
  userSettings.startNumber = Math.max(1, parseInt(startNumInput?.value || "1", 10) || 1);
  userSettings.captureImages = capImagesCb ? capImagesCb.checked : true;
  userSettings.captureVideos = capVideosCb ? capVideosCb.checked : true;
  userSettings.dedupEnabled = dedupCb ? dedupCb.checked : true;
  userSettings.saveAsPrompt = saveAsCb ? saveAsCb.checked : false;

  const saveGlobal = saveGlobalCb ? Boolean(saveGlobalCb.checked) : false;
  await saveUserSettings(saveGlobal);
  closeSettingsModal();
  render();
  showToast(saveGlobal ? "💾 Saved for this tab & set as global default" : "💾 Settings saved for this tab");
});


document.getElementById("settings-cancel-btn")?.addEventListener("click", closeSettingsModal);
document.getElementById("settings-close-btn")?.addEventListener("click", closeSettingsModal);
document.getElementById("open-settings-btn")?.addEventListener("click", openSettingsModal);
document.getElementById("folder-summary-btn")?.addEventListener("click", openSettingsModal);

// ============================================================================
// Toast Notification Helper
// ============================================================================
let toastTimer = null;
function showToast(text) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

// ============================================================================
// Batch Download Confirmation Dialog
// ============================================================================
const confirmModal = document.getElementById("confirm-download-modal");
const confirmCount = document.getElementById("confirm-count");
const confirmFolder = document.getElementById("confirm-folder");
const confirmNames = document.getElementById("confirm-names");
let pendingBatchItems = [];

function showDownloadConfirmation(itemsToDownload) {
  if (!itemsToDownload.length) return;
  pendingBatchItems = itemsToDownload;

  const folder = userSettings.subfolder ? `Downloads/${userSettings.subfolder}` : "Downloads";
  if (confirmCount) confirmCount.textContent = itemsToDownload.length;
  if (confirmFolder) confirmFolder.textContent = folder;

  const firstName = itemsToDownload[0].targetFilename;
  const lastName = itemsToDownload[itemsToDownload.length - 1].targetFilename;
  if (confirmNames) {
    confirmNames.textContent = itemsToDownload.length > 1
      ? `${firstName} to ${lastName}`
      : firstName;
  }

  if (confirmModal) confirmModal.style.display = "flex";
}

function closeConfirmModal() {
  if (confirmModal) confirmModal.style.display = "none";
  pendingBatchItems = [];
}

document.getElementById("confirm-close-btn")?.addEventListener("click", closeConfirmModal);
document.getElementById("confirm-cancel-btn")?.addEventListener("click", closeConfirmModal);

// Proceed Batch Download Button
document.getElementById("confirm-proceed-btn")?.addEventListener("click", () => {
  if (!pendingBatchItems.length) return;
  const toDownload = pendingBatchItems;
  closeConfirmModal();

  chrome.runtime.sendMessage({
    type: "DOWNLOAD_BATCH",
    items: toDownload,
    folder: userSettings.subfolder || "captured",
    saveAs: Boolean(userSettings.saveAsPrompt)
  }, (res) => {
    if (res?.status === "started") {
      showBatchProgressBar(res.count);
    }
  });

  showToast(`⚡ Starting batch download of ${toDownload.length} files...`);
});

// ============================================================================
// Batch Download Progress Banner
// ============================================================================
const progressBanner = document.getElementById("batch-progress-banner");
const progressCurrent = document.getElementById("progress-current");
const progressTotal = document.getElementById("progress-total");
const progressFilename = document.getElementById("progress-filename");
let currentBatchId = null;

function showBatchProgressBar(total) {
  if (progressCurrent) progressCurrent.textContent = "0";
  if (progressTotal) progressTotal.textContent = total;
  if (progressFilename) progressFilename.textContent = "Starting...";
  if (progressBanner) progressBanner.style.display = "flex";
}

function hideBatchProgressBar() {
  if (progressBanner) progressBanner.style.display = "none";
}

document.getElementById("cancel-batch-btn")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CANCEL_BATCH", batchId: currentBatchId });
  hideBatchProgressBar();
  showToast("⏹️ Cancelled remaining downloads");
});

// ============================================================================
// Batch Toolbar Actions
// ============================================================================

// Select All Checkbox
document.getElementById("select-all-cb")?.addEventListener("change", (e) => {
  const isChecked = e.target.checked;
  filteredItemsCache.forEach((item) => {
    if (isChecked) selectedUrls.add(item.url);
    else selectedUrls.delete(item.url);
  });
  render();
});

// Download Selected Button
document.getElementById("dl-selected-btn")?.addEventListener("click", () => {
  const toDownload = filteredItemsCache.filter((i) => selectedUrls.has(i.url));
  if (!toDownload.length) return;

  const preparedItems = toDownload.map((item, idx) => ({
    ...item,
    targetFilename: generateFilename(item, idx + 1, toDownload.length)
  }));

  showDownloadConfirmation(preparedItems);
});

// Download All Button
document.getElementById("dl-all-btn")?.addEventListener("click", () => {
  const filtered = getFiltered();
  if (!filtered.length) return;

  const preparedItems = filtered.map((item, idx) => ({
    ...item,
    targetFilename: generateFilename(item, idx + 1, filtered.length)
  }));

  showDownloadConfirmation(preparedItems);
});

// Clear List Button
document.getElementById("clear-btn")?.addEventListener("click", async () => {
  if (currentTabId == null) return;
  await chrome.storage.session.remove("captured-" + currentTabId);
  items = [];
  selectedUrls.clear();
  render();
  showToast("🗑️ Cleared captured media for this tab");
});

// Debounced Search & Filter Event Listeners
document.getElementById("search-input")?.addEventListener("input", debounce(render, 150));
document.getElementById("filter-type")?.addEventListener("change", render);
document.getElementById("filter-size")?.addEventListener("change", render);

// ============================================================================
// Universal Auto-Slide Key Simulator Controller
// ============================================================================
const fbAssistantBar = document.getElementById("fb-assistant-bar");
const fbPlayBtn = document.getElementById("fb-play-btn");
const fbPlayIcon = document.getElementById("fb-play-icon");
const fbPlayText = document.getElementById("fb-play-text");
const fbNextBtn = document.getElementById("fb-next-btn");
const fbSpeedSelect = document.getElementById("fb-speed-select");
const fbSlideIndicator = document.getElementById("fb-slide-indicator");

let isFbPlaying = false;

async function checkAutoSlideTabStatus() {
  if (!currentTabId || !fbAssistantBar) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isSupported = tab?.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"));

    if (isSupported) {
      fbAssistantBar.style.display = "flex";
      chrome.runtime.sendMessage({ type: "NATIVE_GET_STATUS", tabId: currentTabId }, (res) => {
        if (res?.isActive) {
          setFbPlayState(true);
        } else {
          setFbPlayState(false);
        }
      });
    } else {
      fbAssistantBar.style.display = "none";
      if (isFbPlaying) setFbPlayState(false);
    }
  } catch {
    fbAssistantBar.style.display = "none";
  }
}

function setFbPlayState(playing) {
  isFbPlaying = playing;
  if (!fbPlayBtn || !fbPlayIcon || !fbPlayText || !fbSlideIndicator) return;

  if (playing) {
    fbPlayBtn.style.background = "#059669";
    fbPlayIcon.textContent = "⏸️";
    fbPlayText.textContent = "Stop";
    fbSlideIndicator.textContent = "● Auto-pressing [→]...";
    fbSlideIndicator.style.background = "rgba(16, 185, 129, 0.25)";
    fbSlideIndicator.style.color = "#34d399";
  } else {
    fbPlayBtn.style.background = "#2563eb";
    fbPlayIcon.textContent = "▶️";
    fbPlayText.textContent = "Auto-Play";
    fbSlideIndicator.textContent = "isTrusted: true";
    fbSlideIndicator.style.background = "rgba(16, 185, 129, 0.2)";
    fbSlideIndicator.style.color = "#34d399";
  }
}

// Auto-Play Toggle Button
fbPlayBtn?.addEventListener("click", async () => {
  if (!currentTabId) return;

  if (!isFbPlaying) {
    const speed = parseInt(fbSpeedSelect?.value || "2200", 10) || 2200;
    chrome.runtime.sendMessage({
      type: "NATIVE_START_AUTO_SLIDE",
      tabId: currentTabId,
      intervalMs: speed
    }, (res) => {
      if (res?.status === "started") {
        setFbPlayState(true);
        showToast(`⚡ Hardware [→] auto-slide active (every ${(speed / 1000).toFixed(1)}s)`);
      }
    });
  } else {
    chrome.runtime.sendMessage({ type: "NATIVE_STOP_AUTO_SLIDE", tabId: currentTabId }, () => {
      setFbPlayState(false);
      showToast("⏸️ Auto-slide stopped");
    });
  }
});

// Single Step Button
fbNextBtn?.addEventListener("click", () => {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ type: "NATIVE_TRIGGER_ARROW_RIGHT", tabId: currentTabId }, (res) => {
    if (res?.status === "ok") {
      if (fbSlideIndicator) fbSlideIndicator.textContent = "➡️ Dispatched [→]";
      setTimeout(() => {
        if (!isFbPlaying && fbSlideIndicator) fbSlideIndicator.textContent = "isTrusted: true";
      }, 1000);
    }
  });
});

// Speed Dropdown Change
fbSpeedSelect?.addEventListener("change", () => {
  if (isFbPlaying && currentTabId) {
    const speed = parseInt(fbSpeedSelect.value, 10) || 2200;
    chrome.runtime.sendMessage({
      type: "NATIVE_START_AUTO_SLIDE",
      tabId: currentTabId,
      intervalMs: speed
    });
    showToast(`⏱️ Speed set to ${(speed / 1000).toFixed(1)}s`);
  }
});

// Real-Time Background & Content Script Message Listener
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "CAPTURED_UPDATED" && msg.tabId === currentTabId) {
    loadItems();
  }
  if (msg.type === "BATCH_PROGRESS") {
    if (progressBanner) progressBanner.style.display = "flex";
    if (progressCurrent) progressCurrent.textContent = msg.completed;
    if (progressTotal) progressTotal.textContent = msg.total;
    if (progressFilename) progressFilename.textContent = msg.filename || "";
    if (msg.completed >= msg.total) {
      setTimeout(hideBatchProgressBar, 2500);
    }
  }
  if (msg.type === "NATIVE_SLIDE_TICK" && msg.tabId === currentTabId) {
    if (fbSlideIndicator) fbSlideIndicator.textContent = "● Auto-pressing [→]...";
  }
  if (msg.type === "NATIVE_SLIDE_STOPPED" && msg.tabId === currentTabId) {
    setFbPlayState(false);
    showToast("⏹️ Auto-slide stopped");
  }
});

// Tab Switch Listener (Automatic Profile Synchronization)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  selectedUrls.clear();
  setFbPlayState(false);
  currentTabId = activeInfo.tabId;
  await getActiveTabInfo();
  await loadUserSettings(activeInfo.tabId);
  await loadItems();
  await checkAutoSlideTabStatus();
});

// Initialize on Panel Launch
getActiveTabInfo().then(() => {
  loadUserSettings().then(() => {
    loadItems().then(checkAutoSlideTabStatus);
  });
});







