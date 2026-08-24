// ============================================================================
// Network Image Sniffer & AI Toolkit - Background Service Worker (v3.2.0)
// ============================================================================

const MAX_ITEMS_PER_TAB = 300;
const activeBatchDownloads = {};

// Master Network Sniffing State Management (O(1) Resource Optimization)
let isGlobalSniffingActive = true;
const tabSniffingOverrides = {}; // tabId -> boolean

function isSniffingActive(tabId) {
  if (tabId && tabSniffingOverrides[tabId] !== undefined) {
    return tabSniffingOverrides[tabId];
  }
  return isGlobalSniffingActive;
}

// โหลดค่าเริ่มต้นจาก Storage
chrome.storage.local.get("global_sniffing_active").then((res) => {
  if (res && res.global_sniffing_active !== undefined) {
    isGlobalSniffingActive = Boolean(res.global_sniffing_active);
  }
});

// ตั้งค่า Dynamic Header Modification (ให้มีผลเฉพาะคำขอที่ส่งจาก Extension เท่านั้น ไม่รบกวนหน้าเว็บปกติ)
async function setupRefererRules() {
  if (!chrome.declarativeNetRequest) return;
  const extId = chrome.runtime.id;
  const rules = [
    {
      id: 101,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://www.tiktok.com/" },
          { header: "Origin", operation: "set", value: "https://www.tiktok.com" }
        ]
      },
      condition: {
        urlFilter: "*tiktok*",
        initiatorDomains: [extId],
        resourceTypes: ["xmlhttprequest", "media", "image", "other"]
      }
    },
    {
      id: 102,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://www.tiktok.com/" },
          { header: "Origin", operation: "set", value: "https://www.tiktok.com" }
        ]
      },
      condition: {
        urlFilter: "*byteoversea*",
        initiatorDomains: [extId],
        resourceTypes: ["xmlhttprequest", "media", "image", "other"]
      }
    }
  ];

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [101, 102, 103],
      addRules: rules
    });
  } catch (err) {
    console.warn("[DeclarativeNetRequest] Setup rule error:", err);
  }
}


// ติดตั้ง Context Menus และตั้งค่าเริ่มต้น
chrome.runtime.onInstalled.addListener(() => {
  setupRefererRules();
  chrome.contextMenus.create({
    id: "open-side-panel",
    title: "🌐 เปิด Network Sniffer Panel",
    contexts: ["page", "image", "video"]
  });

  chrome.contextMenus.create({
    id: "quick-download-image",
    title: "💾 ดาวน์โหลดรูปนี้ทันที",
    contexts: ["image"]
  });
});

chrome.runtime.onStartup.addListener(() => {
  setupRefererRules();
});

// จัดการเมื่อคลิก Context Menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "open-side-panel") {
    await chrome.sidePanel.open({ tabId: tab.id });
  }

  if (info.menuItemId === "quick-download-image" && info.srcUrl) {
    const defaultFilename = sanitizeFilename(getFilenameFromUrl(info.srcUrl, "image/jpeg"));
    chrome.downloads.download({
      url: info.srcUrl,
      filename: "captured/" + defaultFilename,
      saveAs: false
    });
  }
});

// ============================================================================
// Helper: URL Normalization เพื่อสกัด Query Parameters ขยะ / Tracking / Cachebusters
// ============================================================================
function normalizeImageUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // รายชื่อพารามิเตอร์ขยะที่มักทำให้รูปเดิมกลายเป็น URL ใหม่
    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "fbclid", "gclid", "_ga", "_nc_cat", "_nc_sid", "_nc_ohc", "_nc_ht",
      "token", "timestamp", "cachebust", "rand", "cb", "ts", "t", "v", "_"
    ];
    
    const searchParams = new URLSearchParams(u.search);
    for (const key of Array.from(searchParams.keys())) {
      const lower = key.toLowerCase();
      if (trackingParams.includes(lower) || lower.startsWith("utm_") || lower.startsWith("_nc_")) {
        searchParams.delete(key);
      }
    }
    
    u.search = searchParams.toString();
    return u.origin + u.pathname + (u.search ? "?" + u.search : "");
  } catch {
    return rawUrl;
  }
}

// ============================================================================
// ============================================================================
// Helper: ตัด Byte-Range Parameters ออกจาก URL เพื่อแปลงเศษ Chunk ให้เป็น Full Video URL
// ============================================================================
function stripVideoChunkParams(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const chunkParams = ["bytestart", "byteend", "range", "bytes", "sq", "initsegment", "fmp4"];
    let modified = false;
    for (const p of chunkParams) {
      if (u.searchParams.has(p)) {
        u.searchParams.delete(p);
        modified = true;
      }
    }
    return modified ? u.href : rawUrl;
  } catch {
    return rawUrl;
  }
}

// ============================================================================
// Helper: ตรวจสอบวิดีโอ MP4 / WebM แท้ และแยกแยะระหว่างไฟล์สตรีมมิ่งที่ไม่ใช่ MP4
// ============================================================================
function isPlayableVideoRequest(rawUrl, contentType) {
  const urlLower = rawUrl.toLowerCase();
  const mimeLower = (contentType || "").toLowerCase();

  // ปฏิเสธเฉพาะไฟล์สตรีมมิ่ง TS / DASH segments แท้ที่ต่อกันไม่ได้
  const nonMp4Streaming = [
    ".mpd", ".m4s", ".ts", "video/mp2t", "application/dash+xml", "segment-", "seg-"
  ];
  for (const ind of nonMp4Streaming) {
    if (urlLower.includes(ind) || mimeLower.includes(ind)) return false;
  }

  const isDirectMime = mimeLower.includes("video/mp4") || mimeLower.includes("video/webm") || mimeLower.includes("video/quicktime");
  const isDirectExt = urlLower.includes(".mp4") || urlLower.includes(".webm");

  return isDirectMime || isDirectExt;
}

// ============================================================================
// Network Sniffer: ดักจับรูปภาพและวิดีโอจาก HTTP Response จริง พร้อม Smart Deduplication
// ============================================================================
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // ⚡ Early Exit O(1): ข้ามทันทีหากปิดสวิตช์ดักจับเพื่อประหยัด CPU/RAM 100%
    if (!isSniffingActive(details.tabId)) return;
    if (details.tabId < 0) return;
    if (details.url.startsWith("chrome-extension://") || details.url.startsWith("data:")) return;


    let contentLength = null;
    let contentType = null;
    let etag = null;

    if (details.responseHeaders) {
      for (const h of details.responseHeaders) {
        const name = h.name.toLowerCase();
        if (name === "content-length") {
          contentLength = parseInt(h.value, 10) || null;
        } else if (name === "content-type") {
          contentType = h.value.toLowerCase();
        } else if (name === "etag") {
          etag = h.value.replace(/["\s]/g, "");
        }
      }
    }

    const isImage = details.type === "image" || (contentType && contentType.startsWith("image/"));
    const isHlsStream = details.url.toLowerCase().includes(".m3u8") || (contentType && (contentType.includes("application/x-mpegurl") || contentType.includes("application/vnd.apple.mpegurl")));
    const isDirectVideo = (details.type === "media" || (contentType && contentType.startsWith("video/")) || isPlayableVideoRequest(details.url, contentType));

    if (!isImage && !isHlsStream && !isDirectVideo) return;

    // กรอง Tracking Pixels หรือ Spacer GIFs ขนาดจิ๋ว (< 30 bytes)
    if (isImage && contentLength !== null && contentLength > 0 && contentLength < 30) return;

    // ถ้าเป็นวิดีโอ ให้แปลง URL จากเศษ Byte-Range ให้กลายเป็น Full Master Video URL
    let targetUrl = details.url;
    let resourceType = "image";

    if (isHlsStream) {
      resourceType = "hls_stream";
    } else if (isDirectVideo) {
      resourceType = "media";
      targetUrl = stripVideoChunkParams(details.url);
    }

    const normalizedUrl = normalizeImageUrl(targetUrl);

    // สร้าง Fingerprint จาก ETag หรือ Path
    let cleanPath = "";
    try { cleanPath = new URL(targetUrl).pathname; } catch {}
    const fingerprint = etag ? `etag_${etag}` : (isDirectVideo ? `video_${cleanPath}` : (contentLength ? `fp_${cleanPath}_${contentLength}` : null));

    addCapturedItem(details.tabId, {
      id: "cap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      url: targetUrl,
      normalizedUrl,
      etag,
      fingerprint,
      resourceType: resourceType,
      contentType: contentType || (isHlsStream ? "application/x-mpegURL" : (isDirectVideo ? "video/mp4" : "image/jpeg")),
      size: isDirectVideo ? null : contentLength,
      statusCode: details.statusCode,
      timestamp: Date.now()
    });
  },
  { urls: ["<all_urls>"], types: ["image", "media", "xmlhttprequest", "other"] },
  ["responseHeaders"]
);


/**
 * บันทึกรายการรูปภาพลง Session Storage พร้อม 4-Tier Deduplication & Tab Capture Toggles
 */
async function addCapturedItem(tabId, item) {
  // ตรวจสอบการตั้งค่าเปิด/ปิดดักจับของแท็บนี้
  const tabSettingsKey = "tab_settings_" + tabId;
  const tabSettingsStore = await chrome.storage.session.get(tabSettingsKey);
  const tabSettings = tabSettingsStore?.[tabSettingsKey] || {};

  if (item.resourceType === "image" && tabSettings.captureImages === false) return;
  if ((item.resourceType === "media" || item.resourceType === "hls_stream") && tabSettings.captureVideos === false) return;

  const key = "captured-" + tabId;
  const store = await chrome.storage.session.get(key);
  const list = store[key] || [];

  // 1. ตรวจสอบ URL ดั้งเดิมที่ตรงกันเป๊ะ
  if (list.some((i) => i.url === item.url)) return;

  // 2. ตรวจสอบ Normalized URL (ตัด Tracking / Cachebuster params)
  if (item.normalizedUrl && list.some((i) => i.normalizedUrl === item.normalizedUrl)) return;

  // 3. ตรวจสอบ ETag ถ้าเซิร์ฟเวอร์ส่งมาตรงกัน
  if (item.etag && list.some((i) => i.etag && i.etag === item.etag)) return;

  // 4. ตรวจสอบ Content Fingerprint (Path เดียวกัน + ขนาดไบต์เท่ากัน)
  if (item.fingerprint && list.some((i) => i.fingerprint && i.fingerprint === item.fingerprint)) return;

  // รูปล่าสุดอยู่บนสุด
  list.unshift(item);
  if (list.length > MAX_ITEMS_PER_TAB) {
    list.length = MAX_ITEMS_PER_TAB;
  }

  await chrome.storage.session.set({ [key]: list });

  // แจ้งให้ UI อัปเดตแบบเรียลไทม์
  chrome.runtime.sendMessage({
    type: "CAPTURED_UPDATED",
    tabId,
    totalCount: list.length,
    newItem: item
  }).catch(() => {});
}

// ============================================================================
// Helper: ดาวน์โหลดไฟล์ผ่าน In-Memory Blob เพื่อส่ง Referer และป้องกัน 403 / .htm Errors
// ============================================================================
async function downloadMediaViaBlob(url, fullPath, saveAs = false) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: blobUrl,
          filename: fullPath,
          saveAs: Boolean(saveAs)
        },
        (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            URL.revokeObjectURL(blobUrl);
            reject(new Error(chrome.runtime.lastError?.message || "Failed to download"));
          } else {
            setTimeout(() => URL.revokeObjectURL(blobUrl), 25000);
            resolve(downloadId);
          }
        }
      );
    });
  } catch (err) {
    console.warn("[Download Engine] Blob fetch failed, falling back to direct URL:", err.message);
    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: url,
          filename: fullPath,
          saveAs: Boolean(saveAs)
        },
        (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            reject(new Error(chrome.runtime.lastError?.message || "Failed to download"));
          } else {
            resolve(downloadId);
          }
        }
      );
    });
  }
}

// ============================================================================
// จัดการ Message จาก Popup และ Side Panel (รองรับ Custom Folder & Sequential Naming)
// ============================================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // สั่งดาวน์โหลดไฟล์เดี่ยว
  if (msg.type === "DOWNLOAD_IMAGE") {
    const subfolder = cleanSubfolderPath(msg.folder || "captured");
    const filename = sanitizeFilename(msg.filename || getFilenameFromUrl(msg.url, msg.contentType));
    const fullPath = subfolder ? `${subfolder}/${filename}` : filename;

    downloadMediaViaBlob(msg.url, fullPath, msg.saveAs)
      .then((id) => sendResponse({ status: "ok", path: fullPath, downloadId: id }))
      .catch((err) => sendResponse({ status: "error", message: err.message }));
    return true;
  }

  // ดาวน์โหลดหลายไฟล์พร้อมกันแบบเรียงลำดับ (Sequential Batch Download)
  if (msg.type === "DOWNLOAD_BATCH") {
    const rawItems = msg.items || [];
    const subfolder = cleanSubfolderPath(msg.folder || "captured");
    const saveAs = Boolean(msg.saveAs);
    const batchId = "batch_" + Date.now();

    // Pre-Download Deduplicator: ป้องกันรายการซ้ำในชุดดาวน์โหลด
    const uniqueItems = [];
    const seenUrls = new Set();
    for (const it of rawItems) {
      if (!seenUrls.has(it.url)) {
        seenUrls.add(it.url);
        uniqueItems.push(it);
      }
    }

    activeBatchDownloads[batchId] = { isCancelled: false, timers: [] };

    uniqueItems.forEach((item, index) => {
      const timer = setTimeout(async () => {
        if (activeBatchDownloads[batchId]?.isCancelled) return;

        const filename = sanitizeFilename(item.targetFilename || getFilenameFromUrl(item.url, item.contentType));
        const fullPath = subfolder ? `${subfolder}/${filename}` : filename;

        try {
          await downloadMediaViaBlob(item.url, fullPath, saveAs);
        } catch (e) {
          console.warn("[Batch Download] Error:", e.message);
        }

        // ส่งความคืบหน้ากลับไปยัง UI
        chrome.runtime.sendMessage({
          type: "BATCH_PROGRESS",
          batchId,
          completed: index + 1,
          total: uniqueItems.length,
          filename
        }).catch(() => {});
      }, index * 250);

      activeBatchDownloads[batchId].timers.push(timer);
    });

    sendResponse({ status: "started", batchId, count: uniqueItems.length });
    return true;
  }

  // ยกเลิกคิวดาวน์โหลดที่กำลังทำงานอยู่
  if (msg.type === "CANCEL_BATCH") {
    const batchId = msg.batchId;
    if (batchId && activeBatchDownloads[batchId]) {
      activeBatchDownloads[batchId].isCancelled = true;
      activeBatchDownloads[batchId].timers.forEach((t) => clearTimeout(t));
      delete activeBatchDownloads[batchId];
    } else {
      // ยกเลิกทุก batch
      Object.keys(activeBatchDownloads).forEach((id) => {
        activeBatchDownloads[id].isCancelled = true;
        activeBatchDownloads[id].timers.forEach((t) => clearTimeout(t));
        delete activeBatchDownloads[id];
      });
    }
    sendResponse({ status: "cancelled" });
    return true;
  }


  // ขอข้อมูลสถิติภาพของแท็บ
  if (msg.type === "GET_TAB_STATS") {
    const tabId = msg.tabId;
    if (!tabId) {
      sendResponse({ count: 0, items: [] });
      return;
    }
    const key = "captured-" + tabId;
    chrome.storage.session.get(key).then((store) => {
      const items = store[key] || [];
      sendResponse({ count: items.length, items });
    });
    return true;
  }

  // จัดการเปิด/ปิด Master Network Sniffing Switch (Global & Tab Level)
  if (msg.type === "SET_SNIFFING_STATE") {
    const targetTabId = msg.tabId;
    const newState = Boolean(msg.enabled);
    if (msg.isGlobal) {
      isGlobalSniffingActive = newState;
      chrome.storage.local.set({ global_sniffing_active: newState });
    } else if (targetTabId) {
      tabSniffingOverrides[targetTabId] = newState;
    }
    chrome.runtime.sendMessage({
      type: "SNIFFING_STATE_CHANGED",
      enabled: newState,
      tabId: targetTabId,
      isGlobal: Boolean(msg.isGlobal)
    }).catch(() => {});
    sendResponse({ status: "ok", enabled: newState });
    return true;
  }

  // ขอสถานะการเปิด/ปิดดักจับของแท็บ
  if (msg.type === "GET_SNIFFING_STATE") {
    const targetTabId = msg.tabId;
    const active = isSniffingActive(targetTabId);
    sendResponse({ enabled: active, isGlobal: isGlobalSniffingActive });
    return true;
  }

  // ==========================================================================
  // Multi-Block Hardware Key Macro Studio Engine (chrome.debugger - isTrusted: true)
  // ==========================================================================

  // เริ่มต้นรันชุดคำสั่ง Macro แบบหลายบล็อก (หรือลูปเดี่ยว)
  if (msg.type === "START_MACRO_SEQUENCE" || msg.type === "NATIVE_START_AUTO_SLIDE") {
    const targetTabId = msg.tabId;
    if (!targetTabId) {
      sendResponse({ status: "error", error: "No tabId provided" });
      return true;
    }
    const blocks = msg.blocks || (msg.intervalMs ? [{ id: "b1", key: "ArrowRight", delayMs: msg.intervalMs }] : null);
    const loopMode = msg.loopMode !== false;
    startMacroSequence(targetTabId, blocks, loopMode);
    sendResponse({ status: "started", tabId: targetTabId });
    return true;
  }

  // หยุดการรันชุดคำสั่ง Macro
  if (msg.type === "STOP_MACRO_SEQUENCE" || msg.type === "NATIVE_STOP_AUTO_SLIDE") {
    const targetTabId = msg.tabId;
    if (targetTabId) {
      stopMacroSequence(targetTabId);
    }
    sendResponse({ status: "stopped" });
    return true;
  }

  // กดปุ่มคีย์ลัดฮาร์ดแวร์แท้ 1 ครั้ง (ระบุปุ่มได้)
  if (msg.type === "STEP_MACRO_SINGLE" || msg.type === "NATIVE_TRIGGER_ARROW_RIGHT") {
    const targetTabId = msg.tabId;
    const keyName = msg.key || "ArrowRight";
    if (!targetTabId) {
      sendResponse({ status: "error", error: "No tabId provided" });
      return true;
    }
    stepMacroSingle(targetTabId, keyName).then((success) => {
      sendResponse({ status: success ? "ok" : "error" });
    });
    return true;
  }

  // ขอสถานะการทำงานของ Macro Runner
  if (msg.type === "GET_MACRO_STATUS" || msg.type === "NATIVE_GET_STATUS") {
    const targetTabId = msg.tabId;
    const runner = targetTabId ? activeMacroLoops[targetTabId] : null;
    sendResponse({
      isActive: Boolean(runner),
      currentStepIndex: runner?.currentStepIndex || 0,
      totalSteps: runner?.blocks?.length || 1,
      loopMode: runner?.loopMode !== false
    });
    return true;
  }

  // รับข้อมูลวิดีโอที่ Content Script สกัดได้จากหน้าเว็บ (เช่น Facebook HD/SD MP4)
  if (msg.type === "ADD_PAGE_EXTRACTED_MEDIA") {
    const tabId = sender.tab?.id || msg.tabId;
    if (tabId && tabId >= 0 && msg.url) {
      const normalizedUrl = normalizeImageUrl(msg.url);
      addCapturedItem(tabId, {
        id: "cap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        url: msg.url,
        normalizedUrl,
        etag: null,
        fingerprint: `extracted_video_${normalizedUrl}`,
        resourceType: msg.resourceType || "media",
        contentType: msg.contentType || "video/mp4",
        size: msg.size || null,
        statusCode: 200,
        timestamp: Date.now()
      });
      sendResponse({ status: "added" });
    }
    return true;
  }
});

// ============================================================================
// Chrome Debugger Protocol Implementation for 100% Genuine isTrusted Keys
// ============================================================================
const attachedTabs = new Set();
const activeMacroLoops = {};

const KEY_MAP = {
  ArrowRight: { code: "ArrowRight", key: "ArrowRight", keyCode: 39 },
  ArrowLeft:  { code: "ArrowLeft",  key: "ArrowLeft",  keyCode: 37 },
  ArrowDown:  { code: "ArrowDown",  key: "ArrowDown",  keyCode: 40 },
  ArrowUp:    { code: "ArrowUp",    key: "ArrowUp",    keyCode: 38 },
  PageDown:   { code: "PageDown",   key: "PageDown",   keyCode: 34 },
  PageUp:     { code: "PageUp",     key: "PageUp",     keyCode: 33 },
  Space:      { code: "Space",      key: " ",          keyCode: 32 },
  Enter:      { code: "Enter",      key: "Enter",      keyCode: 13 }
};

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
    return true;
  } catch (err) {
    if (err?.message?.includes("already attached")) {
      attachedTabs.add(tabId);
      return true;
    }
    console.error("[Sniffer Debugger] Attach error:", err);
    return false;
  }
}

async function detachDebuggerSafe(tabId) {
  if (attachedTabs.has(tabId)) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {}
    attachedTabs.delete(tabId);
  }
}

// ตรวจจับเมื่อผู้ใช้กดปิดแถบ Debugger บนเบราว์เซอร์
chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId) {
    attachedTabs.delete(source.tabId);
    stopMacroSequence(source.tabId);
    chrome.runtime.sendMessage({
      type: "MACRO_SEQUENCE_STOPPED",
      tabId: source.tabId
    }).catch(() => {});
  }
});

/**
 * ส่ง Native Hardware Key Event (isTrusted: true) ไปยัง Browser Engine
 */
async function sendNativeKey(tabId, keyName = "ArrowRight") {
  const keyConfig = KEY_MAP[keyName] || KEY_MAP.ArrowRight;
  const attached = await ensureDebuggerAttached(tabId);
  if (!attached) return false;

  try {
    // 1. rawKeyDown
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      windowsVirtualKeyCode: keyConfig.keyCode,
      nativeVirtualKeyCode: keyConfig.keyCode,
      macCharCode: keyConfig.keyCode,
      code: keyConfig.code,
      key: keyConfig.key,
      unmodifiedText: keyConfig.key.length === 1 ? keyConfig.key : "",
      text: keyConfig.key.length === 1 ? keyConfig.key : ""
    });

    // 2. keyUp
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: keyConfig.keyCode,
      nativeVirtualKeyCode: keyConfig.keyCode,
      macCharCode: keyConfig.keyCode,
      code: keyConfig.code,
      key: keyConfig.key,
      unmodifiedText: keyConfig.key.length === 1 ? keyConfig.key : "",
      text: keyConfig.key.length === 1 ? keyConfig.key : ""
    });

    return true;
  } catch (err) {
    console.error("[Sniffer Debugger] Key dispatch failed:", err);
    return false;
  }
}

function startMacroSequence(tabId, blocks = [], loopMode = true) {
  stopMacroSequence(tabId);
  if (!blocks || !blocks.length) {
    blocks = [{ id: "b1", key: "ArrowRight", delayMs: 2000 }];
  }

  activeMacroLoops[tabId] = {
    blocks,
    loopMode: Boolean(loopMode),
    currentStepIndex: 0,
    timer: null,
    isCancelled: false
  };

  runNextMacroStep(tabId);
}

async function runNextMacroStep(tabId) {
  const runner = activeMacroLoops[tabId];
  if (!runner || runner.isCancelled) return;

  const block = runner.blocks[runner.currentStepIndex];
  if (!block) return;

  // Broadcast step active
  chrome.runtime.sendMessage({
    type: "MACRO_STEP_TICK",
    tabId,
    stepIndex: runner.currentStepIndex,
    totalSteps: runner.blocks.length,
    key: block.key,
    delayMs: block.delayMs
  }).catch(() => {});

  // Dispatch native hardware key
  const success = await sendNativeKey(tabId, block.key);
  if (!success) {
    stopMacroSequence(tabId);
    return;
  }

  // Schedule next step
  const delay = Math.max(300, block.delayMs || 1500);
  runner.timer = setTimeout(() => {
    if (!activeMacroLoops[tabId] || activeMacroLoops[tabId].isCancelled) return;

    let nextIndex = runner.currentStepIndex + 1;
    if (nextIndex >= runner.blocks.length) {
      if (runner.loopMode) {
        nextIndex = 0;
      } else {
        stopMacroSequence(tabId);
        chrome.runtime.sendMessage({ type: "MACRO_SEQUENCE_COMPLETED", tabId }).catch(() => {});
        return;
      }
    }

    runner.currentStepIndex = nextIndex;
    runNextMacroStep(tabId);
  }, delay);
}

function stopMacroSequence(tabId) {
  if (activeMacroLoops[tabId]) {
    activeMacroLoops[tabId].isCancelled = true;
    if (activeMacroLoops[tabId].timer) clearTimeout(activeMacroLoops[tabId].timer);
    delete activeMacroLoops[tabId];
  }
  detachDebuggerSafe(tabId);
}

async function stepMacroSingle(tabId, keyName = "ArrowRight") {
  const success = await sendNativeKey(tabId, keyName);
  return success;
}

// หยุดการทำงานและเคลียร์ข้อมูลเมื่อแท็บถูกปิด
chrome.tabs.onRemoved.addListener((tabId) => {
  stopMacroSequence(tabId);
  chrome.storage.session.remove(["captured-" + tabId, "tab_settings_" + tabId, "tab_macro_" + tabId]).catch(() => {});
});




// เคลียร์รายการเมื่อผู้ใช้เปลี่ยนหน้าเว็บในแท็บเดิม (Main frame เท่านั้น)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  chrome.storage.session.remove("captured-" + details.tabId);
});

// ============================================================================
// Helpers: จัดการและทำความสะอาด Path และชื่อไฟล์
// ============================================================================
function cleanSubfolderPath(folder) {
  if (!folder) return "";
  // ลบเครื่องหมายสแลชหน้า-หลัง และแทนที่อักขระต้องห้าม
  return folder
    .trim()
    .replace(/^[\/\\]+|[\/\\]+$/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\\/g, "/");
}

function sanitizeFilename(name) {
  if (!name) return "image.jpg";
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function getFilenameFromUrl(url, mime) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname.split("/").pop() || "image");
    name = name.split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!/\.[a-z0-9]{2,4}$/i.test(name)) {
      const ext = (mime || "").includes("png") ? "png"
        : (mime || "").includes("webp") ? "webp"
        : (mime || "").includes("svg") ? "svg"
        : (mime || "").includes("video") || (mime || "").includes("mp4") ? "mp4"
        : "jpg";
      name += "." + ext;
    }
    return name;
  } catch {
    return "captured-" + Date.now() + ".jpg";
  }
}


