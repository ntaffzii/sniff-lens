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
    },
    {
      id: 103,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://www.threads.com/" },
          { header: "Origin", operation: "set", value: "https://www.threads.com" }
        ]
      },
      condition: {
        urlFilter: "*threads*",
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
// ============================================================================
// Helper: URL Normalization เพื่อสกัด Query Parameters ขยะ / Tracking / Cachebusters
// ============================================================================
function normalizeImageUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    
    // สำหรับ Facebook, Instagram, Threads, และ TikTok ห้ามตัด Signature / Auth tokens เด็ดขาด
    if (host.includes("fbcdn.net") || host.includes("facebook.com") || host.includes("instagram.com") || host.includes("cdninstagram.com") || host.includes("threads.net") || host.includes("threads.com") || host.includes("tiktokcdn.com") || host.includes("tiktok.com")) {
      return u.href;
    }

    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "fbclid", "gclid", "_ga"
    ];
    
    const searchParams = new URLSearchParams(u.search);
    for (const key of Array.from(searchParams.keys())) {
      const lower = key.toLowerCase();
      if (trackingParams.includes(lower) || lower.startsWith("utm_")) {
        searchParams.delete(key);
      }
    }
    
    u.search = searchParams.toString();
    return u.origin + u.pathname + (u.search ? "?" + u.search : "");
  } catch {
    return rawUrl;
  }
}

function extractMetaMediaId(url) {
  try {
    const match = url.match(/\/([0-9]{10,25})[_\.]/);
    if (match) return match[1];
    const u = new URL(url);
    const fname = u.pathname.split("/").pop() || "";
    const m = fname.match(/^([0-9a-zA-Z_-]+)\./);
    if (m) return m[1];
  } catch {}
  return null;
}

// ============================================================================
// Helper: ตรวจจับ Platform และ Domain แหล่งที่มาของสื่อ (Facebook, IG, TikTok, Web)
// ============================================================================
function detectPlatformAndDomain(url, initiator = "") {
  const urlLower = (url || "").toLowerCase();
  const initLower = (initiator || "").toLowerCase();

  let platform = "web";
  let domain = "web";

  try {
    const u = new URL(url);
    domain = u.hostname.replace(/^www\./, "");
  } catch {}

  if (urlLower.includes("facebook.com") || urlLower.includes("fbcdn.net") || initLower.includes("facebook.com")) {
    platform = "facebook";
    domain = "facebook.com";
  } else if (urlLower.includes("instagram.com") || urlLower.includes("cdninstagram.com") || initLower.includes("instagram.com")) {
    platform = "instagram";
    domain = "instagram.com";
  } else if (urlLower.includes("tiktok.com") || urlLower.includes("byteoversea") || urlLower.includes("ibytedtos") || urlLower.includes("tiktokcdn") || initLower.includes("tiktok.com")) {
    platform = "tiktok";
    domain = "tiktok.com";
  } else if (urlLower.includes("youtube.com") || urlLower.includes("googlevideo.com") || urlLower.includes("ytimg.com")) {
    platform = "youtube";
    domain = "youtube.com";
  } else if (urlLower.includes("twitter.com") || urlLower.includes("x.com") || urlLower.includes("twimg.com") || initLower.includes("twitter.com") || initLower.includes("x.com")) {
    platform = "x";
    domain = "x.com";
  } else if (urlLower.includes("threads.net") || urlLower.includes("threads.com") || initLower.includes("threads.net") || initLower.includes("threads.com")) {
    platform = "threads";
    domain = "threads.com";
  } else if (urlLower.includes("shopee.co")) {
    platform = "shopee";
  } else if (urlLower.includes("lazada.co")) {
    platform = "lazada";
  }

  return { platform, domain };
}

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
// Helper: ตรวจสอบวิดีโอ MP4 / WebM แท้ และแทร็กเสียง Audio
// ============================================================================
function isPlayableVideoRequest(rawUrl, contentType) {
  const urlLower = rawUrl.toLowerCase();
  const mimeLower = (contentType || "").toLowerCase();

  const nonMp4Streaming = [
    ".mpd", ".ts", "video/mp2t", "application/dash+xml"
  ];
  for (const ind of nonMp4Streaming) {
    if (urlLower.includes(ind) || mimeLower.includes(ind)) return false;
  }

  const isDirectMime = mimeLower.includes("video/mp4") || mimeLower.includes("video/webm") || mimeLower.includes("video/quicktime");
  const isDirectExt = urlLower.includes(".mp4") || urlLower.includes(".webm") || urlLower.includes("video");

  return isDirectMime || isDirectExt;
}

function isPlayableAudioRequest(rawUrl, contentType) {
  const urlLower = rawUrl.toLowerCase();
  const mimeLower = (contentType || "").toLowerCase();
  if (mimeLower.startsWith("audio/") || mimeLower.includes("audio/mp4") || mimeLower.includes("audio/aac") || mimeLower.includes("audio/mpeg")) return true;
  if (urlLower.includes(".mp3") || urlLower.includes(".aac") || urlLower.includes(".m4a")) return true;
  if ((urlLower.includes("fbcdn.net") || urlLower.includes("cdninstagram.com")) && urlLower.includes("audio")) return true;
  return false;
}

// ============================================================================
// Network Sniffer: ดักจับรูปภาพ วิดีโอ และเสียงจาก HTTP Response จริง พร้อม Smart Deduplication
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

    const isAudio = isPlayableAudioRequest(details.url, contentType);
    const isImage = !isAudio && (details.type === "image" || (contentType && contentType.startsWith("image/")));
    const isHlsStream = !isAudio && (details.url.toLowerCase().includes(".m3u8") || (contentType && (contentType.includes("application/x-mpegurl") || contentType.includes("application/vnd.apple.mpegurl"))));
    const isDirectVideo = !isAudio && (details.type === "media" || (contentType && contentType.startsWith("video/")) || isPlayableVideoRequest(details.url, contentType));

    if (!isImage && !isHlsStream && !isDirectVideo && !isAudio) return;

    // กรอง Tracking Pixels หรือ Spacer GIFs ขนาดจิ๋ว (< 30 bytes)
    if (isImage && contentLength !== null && contentLength > 0 && contentLength < 30) return;

    let targetUrl = details.url;
    let resourceType = "image";

    if (isHlsStream) {
      resourceType = "hls_stream";
    } else if (isAudio) {
      resourceType = "media";
    } else if (isDirectVideo) {
      resourceType = "media";
      targetUrl = stripVideoChunkParams(details.url);
    }

    const normalizedUrl = normalizeImageUrl(targetUrl);
    const mediaId = extractMetaMediaId(targetUrl);
    const { platform, domain } = detectPlatformAndDomain(targetUrl, details.initiator);
    const dashPlatforms = ["facebook", "instagram", "youtube", "threads"];
    const isMaster = isDirectVideo && !dashPlatforms.includes(platform) && !targetUrl.includes("bytestart");

    // สร้าง Fingerprint จาก ETag หรือ Path
    let cleanPath = "";
    try { cleanPath = new URL(targetUrl).pathname; } catch {}
    const fingerprint = etag ? `etag_${etag}` : (isDirectVideo ? `video_${cleanPath}` : (isAudio ? `audio_${cleanPath}` : (contentLength ? `fp_${cleanPath}_${contentLength}` : null)));

    addCapturedItem(details.tabId, {
      id: "cap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      url: targetUrl,
      normalizedUrl,
      etag,
      mediaId,
      platform,
      domain,
      initiator: details.initiator || "",
      isAudio: isAudio,
      isMaster: isMaster,
      fingerprint,
      resourceType: resourceType,
      contentType: contentType || (isHlsStream ? "application/x-mpegURL" : (isAudio ? "audio/mp4" : (isDirectVideo ? "video/mp4" : "image/jpeg"))),
      size: (isDirectVideo || isAudio) ? null : contentLength,
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
    stepMacroSingle(targetTabId, keyName, msg.holdMs, msg.repeat).then((success) => {
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
      loopMode: runner?.loopMode !== false,
      phase: runner?.phase || null,
      phaseEndsAt: runner?.phaseEndsAt || 0,
      key: runner?.blocks?.[runner.currentStepIndex]?.key || null
    });
    return true;
  }

  // รับข้อมูลวิดีโอที่ Content Script สกัดได้จากหน้าเว็บ (เช่น Facebook HD/SD MP4)
  if (msg.type === "ADD_PAGE_EXTRACTED_MEDIA") {
    const tabId = sender.tab?.id || msg.tabId;
    if (tabId && tabId >= 0 && msg.url) {
      const normalizedUrl = normalizeImageUrl(msg.url);
      const mediaId = extractMetaMediaId(msg.url);
      const { platform, domain } = detectPlatformAndDomain(msg.url, sender.tab?.url || msg.pageUrl);

      addCapturedItem(tabId, {
        id: "cap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        url: msg.url,
        normalizedUrl,
        etag: null,
        mediaId,
        platform: msg.platform || platform,
        domain: msg.domain || domain,
        sourcePageUrl: sender.tab?.url || msg.pageUrl || "",
        isAudio: Boolean(msg.isAudio),
        isMaster: msg.isMaster !== undefined ? msg.isMaster : true,
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

// ----------------------------------------------------------------------------
// Hold Key (กดค้าง) support
// ----------------------------------------------------------------------------
const MACRO_HOLD_MIN_MS = 100;
const MACRO_HOLD_MAX_MS = 60000;
const HOLD_REPEAT_INITIAL_DELAY_MS = 500; // เหมือน Windows keyboard repeat delay
const HOLD_REPEAT_INTERVAL_MS = 33;       // ~30 Hz
const HOLD_MIN_GAP_MS = 100;               // gap ขั้นต่ำหลังปล่อยปุ่ม (Hold)
const TAP_MIN_GAP_MS = 300;                // gap ขั้นต่ำเดิมของ Tap

// Hold ของ STEP_MACRO_SINGLE (ทดสอบ 1 ครั้ง) ที่ยกเลิกได้ตอนกด Stop
const activeSingleHolds = {};

/** ทำให้ block เก่า (ไม่มี mode/holdMs) กลายเป็น Tap เหมือนเดิม */
function normalizeMacroBlock(block) {
  const b = { ...(block || {}) };
  b.key = KEY_MAP[b.key] ? b.key : "ArrowRight";
  b.mode = b.mode === "hold" ? "hold" : "tap";
  b.holdMs = b.mode === "hold"
    ? Math.min(MACRO_HOLD_MAX_MS, Math.max(MACRO_HOLD_MIN_MS, Number(b.holdMs) || 1000))
    : 0;
  b.repeat = b.repeat !== false;
  b.delayMs = Number(b.delayMs) || 1500;
  return b;
}

/** sleep ที่ยกเลิกได้ผ่าน ctl.wake() */
function cancellableSleep(ms, ctl) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      if (ctl.wake === done) ctl.wake = null;
      resolve();
    };
    const t = setTimeout(done, Math.max(0, ms));
    ctl.wake = done;
  });
}

async function dispatchKeyEvent(tabId, type, keyConfig, autoRepeat = false) {
  const isChar = keyConfig.key.length === 1;
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type,
    windowsVirtualKeyCode: keyConfig.keyCode,
    nativeVirtualKeyCode: keyConfig.keyCode,
    macCharCode: keyConfig.keyCode,
    code: keyConfig.code,
    key: keyConfig.key,
    autoRepeat,
    unmodifiedText: isChar ? keyConfig.key : "",
    text: isChar ? keyConfig.key : ""
  });
}

/**
 * กดปุ่มค้าง holdMs มิลลิวินาที: keyDown → (auto-repeat) → keyUp
 * keyUp จะถูกส่งเสมอใน finally แม้ถูกยกเลิกหรือเกิด error กลางทาง (กัน stuck key)
 * ctl: object ที่มี isCancelled / wake (runner หรือ ctl ชั่วคราว)
 */
async function holdNativeKey(tabId, keyName, holdMs, repeat = true, ctl = {}) {
  const keyConfig = KEY_MAP[keyName] || KEY_MAP.ArrowRight;
  const duration = Math.min(MACRO_HOLD_MAX_MS, Math.max(MACRO_HOLD_MIN_MS, Number(holdMs) || MACRO_HOLD_MIN_MS));
  const attached = await ensureDebuggerAttached(tabId);
  if (!attached) return false;

  let isDown = false;
  let ok = true;
  try {
    await dispatchKeyEvent(tabId, "rawKeyDown", keyConfig, false);
    isDown = true;

    const start = performance.now();
    const end = start + duration;
    let nextRepeat = start + HOLD_REPEAT_INITIAL_DELAY_MS;

    while (!ctl.isCancelled) {
      const now = performance.now();
      if (now >= end) break;

      if (repeat && now >= nextRepeat && nextRepeat < end) {
        await dispatchKeyEvent(tabId, "rawKeyDown", keyConfig, true);
        nextRepeat += HOLD_REPEAT_INTERVAL_MS;
        if (nextRepeat < performance.now()) nextRepeat = performance.now() + HOLD_REPEAT_INTERVAL_MS;
        continue;
      }

      const target = repeat ? Math.min(end, nextRepeat) : end;
      await cancellableSleep(target - performance.now(), ctl);
    }
  } catch (err) {
    console.error("[Sniffer Debugger] Hold key failed:", err);
    ok = false;
  } finally {
    if (isDown) {
      try {
        await dispatchKeyEvent(tabId, "keyUp", keyConfig, false);
      } catch (err) {
        // debugger อาจถูก detach ไปแล้ว (browser ปล่อยปุ่มให้เองอยู่แล้ว)
        console.warn("[Sniffer Debugger] keyUp after hold failed:", err);
      }
    }
  }
  return ok;
}

function broadcastMacroTick(tabId, runner, block, phase, phaseEndsAt) {
  runner.phase = phase;
  runner.phaseEndsAt = phaseEndsAt;
  chrome.runtime.sendMessage({
    type: "MACRO_STEP_TICK",
    tabId,
    stepIndex: runner.currentStepIndex,
    totalSteps: runner.blocks.length,
    key: block.key,
    mode: block.mode,
    holdMs: block.holdMs,
    delayMs: block.delayMs,
    phase,
    phaseEndsAt
  }).catch(() => {});
}

function startMacroSequence(tabId, blocks = [], loopMode = true) {
  // หยุดของเดิม (ปล่อยปุ่มที่ค้างอยู่ก่อน) แต่ยังไม่ detach เพราะกำลังจะเริ่มใหม่
  const released = stopMacroSequence(tabId, { detach: false });
  if (!blocks || !blocks.length) {
    blocks = [{ id: "b1", key: "ArrowRight", delayMs: 2000 }];
  }

  activeMacroLoops[tabId] = {
    blocks: blocks.map(normalizeMacroBlock),
    loopMode: Boolean(loopMode),
    currentStepIndex: 0,
    timer: null,
    isCancelled: false,
    wake: null,
    activeHold: null,
    ready: released,
    phase: null,
    phaseEndsAt: 0
  };

  runNextMacroStep(tabId);
}

async function runNextMacroStep(tabId) {
  const runner = activeMacroLoops[tabId];
  if (!runner || runner.isCancelled) return;

  // รอให้ปุ่มจาก sequence เก่า (ถ้ามี) ถูกปล่อยก่อน
  if (runner.ready) {
    await runner.ready;
    runner.ready = null;
    if (runner.isCancelled || activeMacroLoops[tabId] !== runner) return;
  }

  const block = runner.blocks[runner.currentStepIndex];
  if (!block) return;

  const isHold = block.mode === "hold";

  // Dispatch native hardware key
  let success;
  if (isHold) {
    broadcastMacroTick(tabId, runner, block, "hold", Date.now() + block.holdMs);
    runner.activeHold = holdNativeKey(tabId, block.key, block.holdMs, block.repeat, runner);
    success = await runner.activeHold;
    runner.activeHold = null;
    if (runner.isCancelled || activeMacroLoops[tabId] !== runner) return;
  } else {
    const delayForTick = Math.max(TAP_MIN_GAP_MS, block.delayMs || 1500);
    broadcastMacroTick(tabId, runner, block, "wait", Date.now() + delayForTick);
    success = await sendNativeKey(tabId, block.key);
  }
  if (!success) {
    stopMacroSequence(tabId);
    return;
  }

  // Schedule next step
  const delay = Math.max(isHold ? HOLD_MIN_GAP_MS : TAP_MIN_GAP_MS, block.delayMs || 1500);
  if (isHold) {
    broadcastMacroTick(tabId, runner, block, "wait", Date.now() + delay);
  }
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

/**
 * หยุด Macro ของแท็บ — ถ้ากำลังกดค้างอยู่จะส่ง keyUp ให้เสร็จก่อน แล้วค่อย detach debugger
 * @returns {Promise<void>} resolve เมื่อปุ่มที่ค้างอยู่ถูกปล่อยแล้ว
 */
function stopMacroSequence(tabId, { detach = true } = {}) {
  let released = Promise.resolve();

  const runner = activeMacroLoops[tabId];
  if (runner) {
    runner.isCancelled = true;
    if (runner.timer) clearTimeout(runner.timer);
    if (runner.wake) runner.wake(); // ปลุก hold loop ให้จบทันที
    if (runner.activeHold) released = runner.activeHold.catch(() => {});
    delete activeMacroLoops[tabId];
  }

  const single = activeSingleHolds[tabId];
  if (single) {
    single.ctl.isCancelled = true;
    if (single.ctl.wake) single.ctl.wake();
    released = Promise.all([released, single.promise.catch(() => {})]);
  }

  if (detach) {
    released.then(() => {
      // ถ้ามี sequence ใหม่เริ่มขึ้นมาแล้ว ห้าม detach ทับ
      if (!activeMacroLoops[tabId]) detachDebuggerSafe(tabId);
    });
  }
  return released;
}

async function stepMacroSingle(tabId, keyName = "ArrowRight", holdMs = 0, repeat = true) {
  const hold = Number(holdMs) || 0;
  if (hold <= 0) {
    return await sendNativeKey(tabId, keyName);
  }

  if (activeSingleHolds[tabId]) return false; // กำลังทดสอบ hold อยู่แล้ว
  const ctl = { isCancelled: false, wake: null };
  const promise = holdNativeKey(tabId, keyName, hold, repeat !== false, ctl);
  activeSingleHolds[tabId] = { ctl, promise };
  try {
    return await promise;
  } finally {
    delete activeSingleHolds[tabId];
  }
}

// หยุดการทำงานและเคลียร์ข้อมูลเมื่อแท็บถูกปิด
chrome.tabs.onRemoved.addListener((tabId) => {
  stopMacroSequence(tabId);
  chrome.storage.session.remove(["captured-" + tabId, "tab_settings_" + tabId, "tab_macro_" + tabId]).catch(() => {});
});




// จัดการเคลียร์ข้อมูลเฉพาะเมื่อแท็บถูกปิด (ไม่เคลียร์ตอนผู้ใช้เลื่อนดูโพสต์หรือคลิกเปลี่ยนหน้า SPA)
// chrome.webNavigation.onCommitted.addListener((details) => {
//   if (details.frameId !== 0) return;
// });

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


