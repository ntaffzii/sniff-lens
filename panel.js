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

// Master Sniffing Switch UI in Side Panel
const panelLiveBadge = document.getElementById("panel-live-badge");
const panelLiveText = document.getElementById("panel-live-text");

function updatePanelSniffUI(enabled) {
  if (!panelLiveBadge) return;
  if (enabled) {
    panelLiveBadge.classList.remove("paused");
    if (panelLiveText) panelLiveText.textContent = "LIVE";
    panelLiveBadge.title = "Sniffing Active (Click to Pause)";
  } else {
    panelLiveBadge.classList.add("paused");
    if (panelLiveText) panelLiveText.textContent = "PAUSED";
    panelLiveBadge.title = "Sniffing Paused (Click to Resume)";
  }
}

panelLiveBadge?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_SNIFFING_STATE", tabId: currentTabId }, (res) => {
    const currentState = res?.enabled !== false;
    const newState = !currentState;
    chrome.runtime.sendMessage({
      type: "SET_SNIFFING_STATE",
      enabled: newState,
      tabId: currentTabId,
      isGlobal: true
    }, () => {
      updatePanelSniffUI(newState);
      showToast(newState ? "🟢 Network Sniffing Resumed" : "⏸️ Network Sniffing Paused (0% CPU)");
    });
  });
});

/**
 * ค้นหา Audio Track ที่ตรงกับวิดีโอนี้เพื่อนำมารวมกัน (Smart Stream Matcher)
 */
function findMatchingAudioTrack(videoItem, allItems) {
  if (!allItems || !allItems.length) return null;
  const audioTracks = allItems.filter((it) => it.isAudio || it.contentType?.startsWith("audio/"));
  if (!audioTracks.length) return null;

  let closestAudio = null;
  let minTimeDiff = Infinity;
  for (const a of audioTracks) {
    const diff = Math.abs((a.timestamp || 0) - (videoItem.timestamp || 0));
    if (diff < minTimeDiff) {
      minTimeDiff = diff;
      closestAudio = a;
    }
  }
  return closestAudio;
}


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
  if (item.resourceType === "hls_stream") return "HLS ⚡";
  if (item.resourceType === "media") return "MP4";
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
    if (filterType === "image" && item.resourceType !== "image") return false;
    if (filterType === "media" && item.resourceType !== "media" && item.resourceType !== "hls_stream") return false;
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

    if (item.resourceType === "hls_stream") {
      const streamCard = document.createElement("div");
      streamCard.className = "thumb-img";
      streamCard.style.display = "flex";
      streamCard.style.flexDirection = "column";
      streamCard.style.alignItems = "center";
      streamCard.style.justifyContent = "center";
      streamCard.style.background = "linear-gradient(135deg, #064e3b, #0f172a)";
      streamCard.style.color = "#34d399";
      streamCard.style.fontSize = "11px";
      streamCard.style.fontWeight = "700";
      streamCard.style.gap = "4px";
      streamCard.innerHTML = `<span style="font-size:24px;">🎬</span><span>HLS STREAM</span>`;
      dimBadge.textContent = "HLS Stream";
      thumbContainer.appendChild(streamCard);
    } else if (item.resourceType === "media") {
      const videoEl = document.createElement("video");
      videoEl.className = "thumb-img";
      videoEl.src = item.url;
      videoEl.muted = true;
      videoEl.preload = "metadata";
      videoEl.playsInline = true;
      videoEl.onloadedmetadata = () => {
        if (videoEl.videoWidth && videoEl.videoHeight) {
          item.width = videoEl.videoWidth;
          item.height = videoEl.videoHeight;
          item.isAudio = false;
          dimBadge.textContent = `${videoEl.videoWidth}×${videoEl.videoHeight}`;
        } else {
          item.isAudio = true;
          dimBadge.textContent = "Audio 🎵";
          typeBadge.textContent = "AUDIO";
          thumbContainer.innerHTML = "";
          const audioCard = document.createElement("div");
          audioCard.className = "thumb-img";
          audioCard.style.display = "flex";
          audioCard.style.flexDirection = "column";
          audioCard.style.alignItems = "center";
          audioCard.style.justifyContent = "center";
          audioCard.style.background = "linear-gradient(135deg, #312e81, #1e1b4b)";
          audioCard.style.color = "#a5b4fc";
          audioCard.style.fontSize = "11px";
          audioCard.style.fontWeight = "700";
          audioCard.style.gap = "4px";
          audioCard.innerHTML = `<span style="font-size:24px;">🎵</span><span>AUDIO TRACK</span>`;
          thumbContainer.appendChild(audioCard);
          thumbContainer.appendChild(typeBadge);
          thumbContainer.appendChild(dimBadge);
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

// HLS Streaming Downloader Controller
let activeHlsAbortController = null;

async function triggerHlsStitchDownload(item, index = 1, customFilename = null) {
  const hlsBanner = document.getElementById("hls-progress-banner");
  const hlsCurrent = document.getElementById("hls-progress-current");
  const hlsTotal = document.getElementById("hls-progress-total");
  const hlsPercent = document.getElementById("hls-progress-percent");

  const filename = customFilename || generateFilename(item, index, filteredItemsCache.length);
  const folder = userSettings.subfolder || "captured";

  if (activeHlsAbortController) {
    activeHlsAbortController.abort();
  }
  activeHlsAbortController = new AbortController();

  if (hlsBanner) hlsBanner.style.display = "flex";
  if (hlsCurrent) hlsCurrent.textContent = "0";
  if (hlsTotal) hlsTotal.textContent = "...";
  if (hlsPercent) hlsPercent.textContent = "0%";

  showToast(`⚡ Parsing HLS stream for ${filename}...`);

  try {
    const result = await stitchAndDownloadHlsVideo({
      manifestUrl: item.url,
      targetFilename: filename,
      folder: folder,
      concurrency: 6,
      abortSignal: activeHlsAbortController.signal,
      onProgress: (prog) => {
        if (hlsCurrent) hlsCurrent.textContent = prog.completed;
        if (hlsTotal) hlsTotal.textContent = prog.total;
        if (hlsPercent) hlsPercent.textContent = `${prog.percent}%`;
      }
    });

    if (hlsBanner) hlsBanner.style.display = "none";
    showToast(`✅ Downloaded HLS Video (${(result.totalBytes / (1024 * 1024)).toFixed(1)} MB): ${result.fullPath}`);
  } catch (err) {
    if (hlsBanner) hlsBanner.style.display = "none";
    if (err.message && err.message.includes("aborted")) {
      showToast("⏹️ HLS Video stitching cancelled");
    } else {
      showToast(`❌ HLS Stitch failed: ${err.message}`);
    }
  }
}

// Cancel HLS stitching button
document.getElementById("cancel-hls-btn")?.addEventListener("click", () => {
  if (activeHlsAbortController) {
    activeHlsAbortController.abort();
    activeHlsAbortController = null;
  }
  const hlsBanner = document.getElementById("hls-progress-banner");
  if (hlsBanner) hlsBanner.style.display = "none";
  showToast("⏹️ Cancelled HLS stitching");
});

// Single Item Download Trigger (Direct In-Memory Blob & Fast Remux Pipeline)
async function downloadSingleItem(item, index = 1, customFilename = null, forceAudioMerge = true) {
  if (item.resourceType === "hls_stream") {
    triggerHlsStitchDownload(item, index, customFilename);
    return;
  }

  const filename = customFilename || generateFilename(item, index, filteredItemsCache.length);
  const folder = userSettings.subfolder || "captured";
  const subfolder = folder ? folder.replace(/[\\/]+$/, "") + "/" : "";
  const fullPath = subfolder + filename;

  const isVideo = item.resourceType === "media" && !item.isAudio;
  const matchingAudio = isVideo && forceAudioMerge ? findMatchingAudioTrack(item, items) : null;

  // หากวิดีโอนี้มีแทร็กเสียงแยกต่างหาก (Instagram/Reels DASH) ให้รวมไฟล์ทันทีในเบราว์เซอร์ (O(N) Fast Remuxer)
  if (isVideo && matchingAudio && typeof remuxVideoAndAudio === "function") {
    showToast(`⚡ Remuxing 1080p Video + Audio Track (${filename})...`);
    try {
      const [vRes, aRes] = await Promise.all([
        fetch(item.url),
        fetch(matchingAudio.url)
      ]);

      if (vRes.ok && aRes.ok) {
        const [vBuf, aBuf] = await Promise.all([
          vRes.arrayBuffer(),
          aRes.arrayBuffer()
        ]);

        const mergedBlob = await remuxVideoAndAudio(vBuf, aBuf);
        const blobUrl = URL.createObjectURL(mergedBlob);

        chrome.downloads.download({
          url: blobUrl,
          filename: fullPath,
          saveAs: Boolean(userSettings.saveAsPrompt)
        }, (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        });

        showToast(`✅ Downloaded Merged Video+Audio: ${filename}`);
        return;
      }
    } catch (err) {
      console.warn("[Remuxer] Fast remux failed, falling back to direct video:", err);
    }
  }

  showToast(`💾 Downloading: ${filename}...`);

  // Step 1: Direct In-Memory Blob Fetch in Panel context (Bypasses TikTok/Facebook Hotlink 403)
  try {
    const res = await fetch(item.url);
    if (res.ok) {
      const blob = await res.blob();
      const finalBlob = (filename.endsWith(".mp4") && blob.type.includes("html"))
        ? new Blob([blob], { type: "video/mp4" })
        : blob;
      const blobUrl = URL.createObjectURL(finalBlob);

      chrome.downloads.download(
        {
          url: blobUrl,
          filename: fullPath,
          saveAs: Boolean(userSettings.saveAsPrompt)
        },
        (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            // Anchor click fallback for immediate local disk write
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        }
      );
      return;
    }
  } catch (err) {
    console.warn("[Panel Direct Download] Blob fetch failed, delegating to background:", err.message);
  }

  // Step 2: Fallback to Background Service Worker
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_IMAGE",
    url: item.url,
    contentType: item.contentType,
    folder: folder,
    filename: filename,
    saveAs: userSettings.saveAsPrompt
  });
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
    if (item.resourceType === "hls_stream") {
      const hlsCard = document.createElement("div");
      hlsCard.style.display = "flex";
      hlsCard.style.flexDirection = "column";
      hlsCard.style.alignItems = "center";
      hlsCard.style.justifyContent = "center";
      hlsCard.style.padding = "30px 20px";
      hlsCard.style.background = "linear-gradient(135deg, rgba(6, 78, 59, 0.6), rgba(15, 23, 42, 0.9))";
      hlsCard.style.border = "1px solid #059669";
      hlsCard.style.borderRadius = "8px";
      hlsCard.style.gap = "10px";
      hlsCard.innerHTML = `
        <span style="font-size: 48px;">🎬</span>
        <span style="font-size: 14px; font-weight: 700; color: #34d399;">HLS Streaming Playlist (.m3u8)</span>
        <span style="font-size: 11px; color: #a1a1aa; max-width: 320px; text-align: center;">Click <b>"⚡ Stitch & Download"</b> below to concurrently fetch and merge all segment chunks into a complete .mp4 file.</span>
      `;
      wrapper.appendChild(hlsCard);
      if (lightboxDim) lightboxDim.textContent = "HLS Stream";
    } else if (item.isAudio) {
      const audioWrapper = document.createElement("div");
      audioWrapper.style.display = "flex";
      audioWrapper.style.flexDirection = "column";
      audioWrapper.style.alignItems = "center";
      audioWrapper.style.justifyContent = "center";
      audioWrapper.style.padding = "30px 20px";
      audioWrapper.style.background = "linear-gradient(135deg, rgba(49, 46, 129, 0.6), rgba(15, 23, 42, 0.9))";
      audioWrapper.style.border = "1px solid #6366f1";
      audioWrapper.style.borderRadius = "8px";
      audioWrapper.style.gap = "14px";
      audioWrapper.innerHTML = `
        <span style="font-size: 48px;">🎵</span>
        <span style="font-size: 14px; font-weight: 700; color: #a5b4fc;">Audio Track (Soundtrack / Voice)</span>
        <audio id="lightbox-audio" controls autoplay src="${item.url}" style="width: 280px;"></audio>
      `;
      wrapper.appendChild(audioWrapper);
      if (lightboxDim) lightboxDim.textContent = "Audio Stream";
    } else if (item.resourceType === "media") {
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

  const dlBtn = document.getElementById("lightbox-dl-btn");
  if (dlBtn) {
    if (item.resourceType === "hls_stream") {
      dlBtn.textContent = "⚡ Stitch & Download HLS Video";
    } else if (item.isAudio) {
      dlBtn.textContent = "💾 Download Audio Track";
    } else if (item.resourceType === "media") {
      const hasAudio = Boolean(findMatchingAudioTrack(item, items));
      dlBtn.textContent = hasAudio ? "⚡ Download Merged Video + Audio (1080p)" : "💾 Download Video";
    } else {
      dlBtn.textContent = "💾 Download Image";
    }
  }



  if (lightboxSize) lightboxSize.textContent = humanSize(item.size);
  if (lightboxMime) lightboxMime.textContent = item.contentType || "image/jpeg";
  if (lightboxIndexBadge) lightboxIndexBadge.textContent = `${currentLightboxIndex + 1} / ${filteredItemsCache.length}`;

  if (lightboxDim && item.resourceType !== "hls_stream") {
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
// Multi-Block Hardware Key Macro Studio Controller
// ============================================================================
const fbAssistantBar = document.getElementById("fb-assistant-bar");
const fbPlayBtn = document.getElementById("fb-play-btn");
const fbPlayIcon = document.getElementById("fb-play-icon");
const fbPlayText = document.getElementById("fb-play-text");
const fbNextBtn = document.getElementById("fb-next-btn");
const fbSpeedSelect = document.getElementById("fb-speed-select");
const fbSlideIndicator = document.getElementById("fb-slide-indicator");
const macroStepBadge = document.getElementById("macro-step-badge");
const macroActiveStepsContainer = document.getElementById("macro-active-steps-container");

// Macro Studio Modal Elements
const macroStudioModal = document.getElementById("macro-studio-modal");
const openMacroStudioBtn = document.getElementById("open-macro-studio-btn");
const macroModalCloseBtn = document.getElementById("macro-modal-close-btn");
const macroModalCancelBtn = document.getElementById("macro-modal-cancel-btn");
const macroModalApplyBtn = document.getElementById("macro-modal-apply-btn");
const macroBlocksList = document.getElementById("macro-blocks-list");
const addMacroBlockBtn = document.getElementById("add-macro-block-btn");
const macroLoopModeCb = document.getElementById("macro-loop-mode-cb");
const macroBlocksCountLabel = document.getElementById("macro-blocks-count-label");

// Direction Quick Buttons
const dirButtons = {
  ArrowRight: document.getElementById("macro-btn-right"),
  ArrowDown: document.getElementById("macro-btn-down"),
  ArrowLeft: document.getElementById("macro-btn-left"),
  ArrowUp: document.getElementById("macro-btn-up")
};

// Macro State
let currentMacroBlocks = [
  { id: "b_" + Date.now(), key: "ArrowRight", delayMs: 2200 }
];
let currentMacroDirection = "ArrowRight";
let isMacroPlaying = false;
let isMacroLoop = true;

const KEY_LABELS = {
  ArrowRight: "➡️ ขวา (Right)",
  ArrowDown: "⬇️ ล่าง (Down / Reels)",
  ArrowLeft: "⬅️ ซ้าย (Left)",
  ArrowUp: "⬆️ บน (Up)",
  PageDown: "⇟ PageDown (Feed)",
  PageUp: "⇞ PageUp",
  Space: "␣ Spacebar",
  Enter: "↵ Enter"
};

// อัปเดตสีปุ่มทิศทางด่วน
function updateDirButtonsUI(activeDir) {
  Object.keys(dirButtons).forEach((dir) => {
    const btn = dirButtons[dir];
    if (!btn) return;
    if (dir === activeDir && currentMacroBlocks.length === 1) {
      btn.style.background = "#2563eb";
      btn.style.color = "#fff";
    } else {
      btn.style.background = "transparent";
      btn.style.color = "#94a3b8";
    }
  });
}

// กดเลือกทิศทางด่วน
Object.keys(dirButtons).forEach((dir) => {
  dirButtons[dir]?.addEventListener("click", () => {
    currentMacroDirection = dir;
    const speed = parseInt(fbSpeedSelect?.value || "2200", 10) || 2200;
    currentMacroBlocks = [{ id: "b_" + Date.now(), key: dir, delayMs: speed }];
    updateDirButtonsUI(dir);
    updateMacroBadge();
    saveTabMacroState();

    if (isMacroPlaying && currentTabId) {
      chrome.runtime.sendMessage({
        type: "START_MACRO_SEQUENCE",
        tabId: currentTabId,
        blocks: currentMacroBlocks,
        loopMode: isMacroLoop
      });
    }
    showToast(`🎯 Set direction to ${KEY_LABELS[dir] || dir}`);
  });
});

function updateMacroBadge() {
  if (!macroStepBadge) return;
  const count = currentMacroBlocks.length;
  if (count === 1) {
    const key = currentMacroBlocks[0].key;
    const icon = key === "ArrowDown" ? "⬇️" : (key === "ArrowLeft" ? "⬅️" : (key === "ArrowUp" ? "⬆️" : "➡️"));
    macroStepBadge.textContent = `1 Step (${icon})`;
  } else {
    macroStepBadge.textContent = `${count} Steps Chain`;
  }
}

// ============================================================================
// Macro Studio Modal Builder & Renderer
// ============================================================================
function renderMacroBlocksInModal() {
  if (!macroBlocksList) return;
  macroBlocksList.innerHTML = "";

  if (macroBlocksCountLabel) {
    macroBlocksCountLabel.textContent = `${currentMacroBlocks.length} Block${currentMacroBlocks.length > 1 ? "s" : ""}`;
  }

  currentMacroBlocks.forEach((block, idx) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.background = "#141417";
    row.style.border = "1px solid #27272a";
    row.style.borderRadius = "6px";
    row.style.padding = "6px 8px";

    // Step Number Badge
    const numBadge = document.createElement("span");
    numBadge.style.fontSize = "10px";
    numBadge.style.fontWeight = "700";
    numBadge.style.color = "#a5b4fc";
    numBadge.style.minWidth = "42px";
    numBadge.textContent = `Step ${idx + 1}`;
    row.appendChild(numBadge);

    // Key Dropdown
    const keySelect = document.createElement("select");
    keySelect.className = "form-input";
    keySelect.style.flex = "1.6";
    keySelect.style.padding = "3px 5px";
    keySelect.style.fontSize = "10px";

    Object.keys(KEY_LABELS).forEach((k) => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = KEY_LABELS[k];
      if (block.key === k) opt.selected = true;
      keySelect.appendChild(opt);
    });

    keySelect.addEventListener("change", () => {
      block.key = keySelect.value;
    });
    row.appendChild(keySelect);

    // Delay Input (Seconds)
    const delayContainer = document.createElement("div");
    delayContainer.style.display = "flex";
    delayContainer.style.alignItems = "center";
    delayContainer.style.gap = "3px";
    delayContainer.style.flex = "1";

    const delayInput = document.createElement("input");
    delayInput.type = "number";
    delayInput.className = "form-input";
    delayInput.style.width = "46px";
    delayInput.style.padding = "3px 4px";
    delayInput.style.fontSize = "10px";
    delayInput.min = "0.3";
    delayInput.step = "0.1";
    delayInput.value = (block.delayMs / 1000).toFixed(1);

    delayInput.addEventListener("input", () => {
      const sec = parseFloat(delayInput.value) || 1.5;
      block.delayMs = Math.round(sec * 1000);
    });

    const secLabel = document.createElement("span");
    secLabel.style.fontSize = "9.5px";
    secLabel.style.color = "#71717a";
    secLabel.textContent = "sec";

    delayContainer.appendChild(delayInput);
    delayContainer.appendChild(secLabel);
    row.appendChild(delayContainer);

    // Delete Button
    if (currentMacroBlocks.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.textContent = "🗑️";
      delBtn.style.background = "transparent";
      delBtn.style.border = "none";
      delBtn.style.cursor = "pointer";
      delBtn.style.fontSize = "11px";
      delBtn.title = "Delete this step";
      delBtn.addEventListener("click", () => {
        currentMacroBlocks.splice(idx, 1);
        renderMacroBlocksInModal();
      });
      row.appendChild(delBtn);
    }

    macroBlocksList.appendChild(row);
  });
}

// Add New Block Button in Modal
addMacroBlockBtn?.addEventListener("click", () => {
  const lastBlock = currentMacroBlocks[currentMacroBlocks.length - 1];
  currentMacroBlocks.push({
    id: "b_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    key: lastBlock ? lastBlock.key : "ArrowRight",
    delayMs: lastBlock ? lastBlock.delayMs : 2000
  });
  renderMacroBlocksInModal();
});

// Open Modal
openMacroStudioBtn?.addEventListener("click", () => {
  if (macroLoopModeCb) macroLoopModeCb.checked = isMacroLoop;
  renderMacroBlocksInModal();
  if (macroStudioModal) macroStudioModal.style.display = "flex";
});

// Close Modal
function closeMacroStudioModal() {
  if (macroStudioModal) macroStudioModal.style.display = "none";
}
macroModalCloseBtn?.addEventListener("click", closeMacroStudioModal);
macroModalCancelBtn?.addEventListener("click", closeMacroStudioModal);

// Apply Macro Sequence
macroModalApplyBtn?.addEventListener("click", () => {
  if (macroLoopModeCb) isMacroLoop = macroLoopModeCb.checked;
  closeMacroStudioModal();
  updateMacroBadge();
  updateDirButtonsUI(currentMacroBlocks.length === 1 ? currentMacroBlocks[0].key : "");
  saveTabMacroState();

  if (isMacroPlaying && currentTabId) {
    chrome.runtime.sendMessage({
      type: "START_MACRO_SEQUENCE",
      tabId: currentTabId,
      blocks: currentMacroBlocks,
      loopMode: isMacroLoop
    });
  }
  showToast(`✅ Applied ${currentMacroBlocks.length} Macro Action Blocks!`);
});

// Built-in Presets in Modal
document.getElementById("preset-macro-fb")?.addEventListener("click", () => {
  currentMacroBlocks = [{ id: "b_fb", key: "ArrowRight", delayMs: 1800 }];
  renderMacroBlocksInModal();
});
document.getElementById("preset-macro-tiktok")?.addEventListener("click", () => {
  currentMacroBlocks = [{ id: "b_tt", key: "ArrowDown", delayMs: 3000 }];
  renderMacroBlocksInModal();
});
document.getElementById("preset-macro-grid")?.addEventListener("click", () => {
  currentMacroBlocks = [
    { id: "b_g1", key: "ArrowRight", delayMs: 1500 },
    { id: "b_g2", key: "ArrowRight", delayMs: 1500 },
    { id: "b_g3", key: "ArrowRight", delayMs: 1500 },
    { id: "b_g4", key: "ArrowDown", delayMs: 2500 }
  ];
  renderMacroBlocksInModal();
});
document.getElementById("preset-macro-scroll")?.addEventListener("click", () => {
  currentMacroBlocks = [{ id: "b_scroll", key: "PageDown", delayMs: 3500 }];
  renderMacroBlocksInModal();
});

// Save & Load Tab Macro Profiles
async function saveTabMacroState() {
  if (!currentTabId) return;
  const key = "tab_macro_" + currentTabId;
  await chrome.storage.session.set({
    [key]: {
      blocks: currentMacroBlocks,
      loopMode: isMacroLoop,
      direction: currentMacroDirection
    }
  });
}

async function loadTabMacroState(tabId) {
  if (!tabId) return;
  const key = "tab_macro_" + tabId;
  const store = await chrome.storage.session.get(key);
  const data = store[key];
  if (data?.blocks && data.blocks.length) {
    currentMacroBlocks = data.blocks;
    isMacroLoop = data.loopMode !== false;
    currentMacroDirection = data.direction || "ArrowRight";
  } else {
    currentMacroBlocks = [{ id: "b_init", key: "ArrowRight", delayMs: 2200 }];
    isMacroLoop = true;
    currentMacroDirection = "ArrowRight";
  }
  updateMacroBadge();
  updateDirButtonsUI(currentMacroBlocks.length === 1 ? currentMacroBlocks[0].key : "");
}

// ============================================================================
// Auto-Play / Stop & Step Execution
// ============================================================================
async function checkAutoSlideTabStatus() {
  if (!currentTabId || !fbAssistantBar) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isSupported = tab?.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"));

    if (isSupported) {
      fbAssistantBar.style.display = "flex";
      chrome.runtime.sendMessage({ type: "GET_MACRO_STATUS", tabId: currentTabId }, (res) => {
        if (res?.isActive) {
          setFbPlayState(true, res.currentStepIndex, res.totalSteps);
        } else {
          setFbPlayState(false);
        }
      });
    } else {
      fbAssistantBar.style.display = "none";
      if (isMacroPlaying) setFbPlayState(false);
    }
  } catch {
    fbAssistantBar.style.display = "none";
  }
}

function setFbPlayState(playing, stepIdx = 0, totalSteps = 1) {
  isMacroPlaying = playing;
  if (!fbPlayBtn || !fbPlayIcon || !fbPlayText || !fbSlideIndicator) return;

  if (playing) {
    fbPlayBtn.style.background = "#059669";
    fbPlayIcon.textContent = "⏸️";
    fbPlayText.textContent = "Stop";
    fbSlideIndicator.textContent = `● Step ${stepIdx + 1}/${totalSteps}`;
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

  if (!isMacroPlaying) {
    chrome.runtime.sendMessage({
      type: "START_MACRO_SEQUENCE",
      tabId: currentTabId,
      blocks: currentMacroBlocks,
      loopMode: isMacroLoop
    }, (res) => {
      if (res?.status === "started") {
        setFbPlayState(true, 0, currentMacroBlocks.length);
        showToast(`⚡ Macro sequence active (${currentMacroBlocks.length} steps)`);
      }
    });
  } else {
    chrome.runtime.sendMessage({ type: "STOP_MACRO_SEQUENCE", tabId: currentTabId }, () => {
      setFbPlayState(false);
      showToast("⏸️ Macro stopped");
    });
  }
});

// Single Step Button
fbNextBtn?.addEventListener("click", () => {
  if (!currentTabId) return;
  const activeKey = currentMacroBlocks[0]?.key || "ArrowRight";
  chrome.runtime.sendMessage({ type: "STEP_MACRO_SINGLE", tabId: currentTabId, key: activeKey }, (res) => {
    if (res?.status === "ok") {
      if (fbSlideIndicator) fbSlideIndicator.textContent = `➡️ Dispatched [${activeKey}]`;
      setTimeout(() => {
        if (!isMacroPlaying && fbSlideIndicator) fbSlideIndicator.textContent = "isTrusted: true";
      }, 1000);
    }
  });
});

// Speed Dropdown Change
fbSpeedSelect?.addEventListener("change", () => {
  const speed = parseInt(fbSpeedSelect.value, 10) || 2200;
  if (currentMacroBlocks.length === 1) {
    currentMacroBlocks[0].delayMs = speed;
    saveTabMacroState();
  }
  if (isMacroPlaying && currentTabId) {
    chrome.runtime.sendMessage({
      type: "START_MACRO_SEQUENCE",
      tabId: currentTabId,
      blocks: currentMacroBlocks,
      loopMode: isMacroLoop
    });
  }
  showToast(`⏱️ Step delay set to ${(speed / 1000).toFixed(1)}s`);
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
  if (msg.type === "MACRO_STEP_TICK" && msg.tabId === currentTabId) {
    if (fbSlideIndicator) {
      fbSlideIndicator.textContent = `● Step ${msg.stepIndex + 1}/${msg.totalSteps} [${msg.key}]`;
    }
  }
  if (msg.type === "SNIFFING_STATE_CHANGED") {
    if (msg.isGlobal || msg.tabId === currentTabId) {
      updatePanelSniffUI(msg.enabled);
    }
  }
});

// Tab Switch Listener (Automatic Profile Synchronization)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  selectedUrls.clear();
  setFbPlayState(false);
  currentTabId = activeInfo.tabId;
  await getActiveTabInfo();
  await loadUserSettings(activeInfo.tabId);
  await loadTabMacroState(activeInfo.tabId);
  await loadItems();
  await checkAutoSlideTabStatus();

  chrome.runtime.sendMessage({ type: "GET_SNIFFING_STATE", tabId: currentTabId }, (res) => {
    updatePanelSniffUI(res?.enabled !== false);
  });
});

// Initialize on Panel Launch
getActiveTabInfo().then(() => {
  loadUserSettings().then(() => {
    loadTabMacroState(currentTabId).then(() => {
      loadItems().then(checkAutoSlideTabStatus);

      chrome.runtime.sendMessage({ type: "GET_SNIFFING_STATE", tabId: currentTabId }, (res) => {
        updatePanelSniffUI(res?.enabled !== false);
      });
    });
  });
});








