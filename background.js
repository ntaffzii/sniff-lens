// ============================================================================
// Network Image Sniffer & AI Toolkit - Background Service Worker (v2.1.0)
// ============================================================================

const MAX_ITEMS_PER_TAB = 300;
const activeBatchDownloads = {};

// ติดตั้ง Context Menus และตั้งค่าเริ่มต้น
chrome.runtime.onInstalled.addListener(() => {
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
// Helper: ตรวจสอบวิดีโอ MP4 / WebM แท้ที่ไม่ได้เข้ารหัส และปฏิเสธ Streaming Chunks
// ============================================================================
function isStandaloneMp4Video(rawUrl, contentType, contentLength, statusCode, responseHeaders) {
  // 1. ปฏิเสธ HTTP 206 Partial Content เด็ดขาด (เป็นเศษ Chunks)
  if (statusCode === 206) return false;

  const urlLower = rawUrl.toLowerCase();
  const mimeLower = (contentType || "").toLowerCase();

  // 2. ปฏิเสธหากมี Header Content-Range (เป็นเศษ Byte-Range)
  if (responseHeaders && Array.isArray(responseHeaders)) {
    for (const h of responseHeaders) {
      if (h.name.toLowerCase() === "content-range") return false;
    }
  }

  // 3. ปฏิเสธไฟล์สตรีมมิ่ง, Manifests, และ Byte-Range Chunks ทุกประเภท (Facebook / Web Chunks)
  const streamingBlacklist = [
    ".m3u8", ".mpd", ".m4s", ".ts", "video/mp2t", "application/x-mpegurl",
    "application/vnd.apple.mpegurl", "application/dash+xml", "init.mp4",
    "/hls/", "/dash/", "segment-", "seg-", "chunk-", "bytestart=", "byteend=",
    "range=", "bytes=", "sq=", "initsegment=", "_fmp4"
  ];
  for (const ind of streamingBlacklist) {
    if (urlLower.includes(ind) || mimeLower.includes(ind)) return false;
  }

  // 4. ต้องเป็น MIME type ของวิดีโอแท้ หรือมีนามสกุล .mp4, .webm
  const isDirectMime = mimeLower.includes("video/mp4") || mimeLower.includes("video/webm") || mimeLower.includes("video/quicktime");
  const isDirectExt = urlLower.includes(".mp4") || urlLower.includes(".webm");

  if (!isDirectMime && !isDirectExt) return false;

  // 5. วิดีโอ MP4 แท้ควรมีขนาด > 50 KB (ป้องกัน Header เปล่าหรือ Chunks ชำรุด)
  if (contentLength !== null && contentLength > 0 && contentLength < 51200) return false;

  return true;
}

// ============================================================================
// Network Sniffer: ดักจับรูปภาพและวิดีโอจาก HTTP Response จริง พร้อม Smart Deduplication
// ============================================================================
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // ข้าม request ที่ไม่ได้มาจากแท็บปกติ
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
    const isDirectVideo = details.type === "media" || (contentType && contentType.startsWith("video/"));

    if (!isImage && !isHlsStream && !isDirectVideo) return;

    // กรอง Tracking Pixels หรือ Spacer GIFs ขนาดจิ๋ว (< 30 bytes)
    if (isImage && contentLength !== null && contentLength > 0 && contentLength < 30) return;

    // กรองเฉพาะ Standalone MP4/WebM Videos เท่านั้น ปฏิเสธ Chunks สตรีมมิ่งย่อยและ Byte-Range Chunks
    if (isDirectVideo && !isHlsStream && !isStandaloneMp4Video(details.url, contentType, contentLength, details.statusCode, details.responseHeaders)) return;

    const normalizedUrl = normalizeImageUrl(details.url);

    // กำหนด Resource Type ที่ชัดเจน
    let resourceType = "image";
    if (isHlsStream) resourceType = "hls_stream";
    else if (isDirectVideo) resourceType = "media";

    // สร้าง Fingerprint จาก ETag หรือ Path + Size
    let cleanPath = "";
    try { cleanPath = new URL(details.url).pathname; } catch {}
    const fingerprint = etag ? `etag_${etag}` : (contentLength ? `fp_${cleanPath}_${contentLength}` : null);

    addCapturedItem(details.tabId, {
      id: "cap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      url: details.url,
      normalizedUrl,
      etag,
      fingerprint,
      resourceType: resourceType,
      contentType: contentType || (isHlsStream ? "application/x-mpegURL" : (isDirectVideo ? "video/mp4" : "image/jpeg")),
      size: contentLength,
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
// จัดการ Message จาก Popup และ Side Panel (รองรับ Custom Folder & Sequential Naming)
// ============================================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // สั่งดาวน์โหลดไฟล์เดี่ยว
  if (msg.type === "DOWNLOAD_IMAGE") {
    const subfolder = cleanSubfolderPath(msg.folder || "captured");
    const filename = sanitizeFilename(msg.filename || getFilenameFromUrl(msg.url, msg.contentType));
    const fullPath = subfolder ? `${subfolder}/${filename}` : filename;

    chrome.downloads.download({
      url: msg.url,
      filename: fullPath,
      saveAs: Boolean(msg.saveAs)
    });
    sendResponse({ status: "ok", path: fullPath });
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
      const timer = setTimeout(() => {
        if (activeBatchDownloads[batchId]?.isCancelled) return;

        const filename = sanitizeFilename(item.targetFilename || getFilenameFromUrl(item.url, item.contentType));
        const fullPath = subfolder ? `${subfolder}/${filename}` : filename;

        chrome.downloads.download({
          url: item.url,
          filename: fullPath,
          saveAs: saveAs
        });

        // ส่งความคืบหน้ากลับไปยัง UI
        chrome.runtime.sendMessage({
          type: "BATCH_PROGRESS",
          batchId,
          completed: index + 1,
          total: uniqueItems.length,
          filename
        }).catch(() => {});
      }, index * 200);

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

  // ==========================================================================
  // Native Hardware Input Engine (chrome.debugger - isTrusted: true 100%)
  // ==========================================================================

  // กดปุ่ม [→] ฮาร์ดแวร์แท้ 1 ครั้ง
  if (msg.type === "NATIVE_TRIGGER_ARROW_RIGHT") {
    const targetTabId = msg.tabId;
    if (!targetTabId) {
      sendResponse({ status: "error", error: "No tabId provided" });
      return true;
    }
    sendNativeArrowRightKey(targetTabId).then((success) => {
      sendResponse({ status: success ? "ok" : "error" });
    });
    return true;
  }

  // เริ่มต้น Loop กด [→] ฮาร์ดแวร์แท้อัตโนมัติ
  if (msg.type === "NATIVE_START_AUTO_SLIDE") {
    const targetTabId = msg.tabId;
    const intervalMs = msg.intervalMs || 2000;
    if (!targetTabId) {
      sendResponse({ status: "error", error: "No tabId provided" });
      return true;
    }
    startNativeAutoSlide(targetTabId, intervalMs);
    sendResponse({ status: "started", intervalMs });
    return true;
  }

  // หยุด Loop กดอัตโนมัติ
  if (msg.type === "NATIVE_STOP_AUTO_SLIDE") {
    const targetTabId = msg.tabId;
    if (targetTabId) {
      stopNativeAutoSlide(targetTabId);
    }
    sendResponse({ status: "stopped" });
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
const nativeAutoSlideLoops = {};

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
    stopNativeAutoSlide(source.tabId);
    chrome.runtime.sendMessage({
      type: "NATIVE_SLIDE_STOPPED",
      tabId: source.tabId
    }).catch(() => {});
  }
});

/**
 * ส่ง Native Hardware Key Event (isTrusted: true) ไปยัง Browser Engine
 */
async function sendNativeArrowRightKey(tabId) {
  const attached = await ensureDebuggerAttached(tabId);
  if (!attached) return false;

  try {
    // 1. rawKeyDown (KeyCode 39, ArrowRight)
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39,
      macCharCode: 39,
      code: "ArrowRight",
      key: "ArrowRight",
      unmodifiedText: "",
      text: ""
    });

    // 2. keyUp
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39,
      macCharCode: 39,
      code: "ArrowRight",
      key: "ArrowRight",
      unmodifiedText: "",
      text: ""
    });

    return true;
  } catch (err) {
    console.error("[Sniffer Debugger] Key dispatch failed:", err);
    return false;
  }
}

function startNativeAutoSlide(tabId, intervalMs = 2000) {
  stopNativeAutoSlide(tabId);
  const ms = Math.max(500, intervalMs);

  // กดครั้งแรกทันที
  sendNativeArrowRightKey(tabId);

  const timer = setInterval(async () => {
    const success = await sendNativeArrowRightKey(tabId);
    if (!success) {
      stopNativeAutoSlide(tabId);
      return;
    }
    chrome.runtime.sendMessage({
      type: "NATIVE_SLIDE_TICK",
      tabId,
      timestamp: Date.now()
    }).catch(() => {});
  }, ms);

  nativeAutoSlideLoops[tabId] = { timer, intervalMs: ms };
}

function stopNativeAutoSlide(tabId) {
  if (nativeAutoSlideLoops[tabId]) {
    clearInterval(nativeAutoSlideLoops[tabId].timer);
    delete nativeAutoSlideLoops[tabId];
  }
  detachDebuggerSafe(tabId);
}

// หยุดการทำงานและเคลียร์ข้อมูลเมื่อแท็บถูกปิด
chrome.tabs.onRemoved.addListener((tabId) => {
  stopNativeAutoSlide(tabId);
  chrome.storage.session.remove(["captured-" + tabId, "tab_settings_" + tabId]).catch(() => {});
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


