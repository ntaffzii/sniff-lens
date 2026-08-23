// ============================================================================
// Network Image Sniffer & AI Toolkit - Content Script (v2.3.0)
// Universal Auto-ArrowRight Key Simulator (สำหรับ Facebook และทุกหน้าเว็บ)
// ============================================================================

let autoSlideTimer = null;
let isAutoSlideActive = false;
let slideIntervalMs = 1800;
let lastMouseX = window.innerWidth / 2;
let lastMouseY = window.innerHeight / 2;
let floatingPill = null;

// ติดตามตำแหน่งเมาส์ของผู้ใช้บนหน้าเว็บเสมอ
window.addEventListener("mousemove", (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
}, { passive: true });

/**
 * ฟังก์ชันหลัก: จำลองการกดปุ่มลูกศรขวา [→] (ArrowRight) แบบสมจริงลงบน Element ที่เมาส์ชี้อยู่
 */
function pressArrowRightKey() {
  try {
    // 1. หา Element ที่อยู่ใต้เคอร์เซอร์เมาส์ หรือ Element ที่กำลัง Focused อยู่
    let targetElem = document.elementFromPoint(lastMouseX, lastMouseY);
    if (!targetElem || targetElem === document.documentElement) {
      targetElem = document.activeElement || document.body || document;
    }

    // โฟกัสไปที่ Element นั้น
    if (targetElem && typeof targetElem.focus === "function") {
      try { targetElem.focus({ preventScroll: true }); } catch {}
    }

    // 2. สร้าง KeyboardEvent options ที่ครบถ้วนที่สุด
    const keyEventInit = {
      key: "ArrowRight",
      code: "ArrowRight",
      keyCode: 39,
      which: 39,
      charCode: 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    };

    // ส่ง Event ไปยังเป้าหมาย, Body, Document, และ Window
    const evDown = new KeyboardEvent("keydown", keyEventInit);
    const evUp = new KeyboardEvent("keyup", keyEventInit);

    targetElem.dispatchEvent(evDown);
    targetElem.dispatchEvent(evUp);
    document.dispatchEvent(evDown);
    document.dispatchEvent(evUp);
    window.dispatchEvent(evDown);
    window.dispatchEvent(evUp);

    // 3. กลไกเสริมสำหรับ Facebook Photo Theater: คลิกปุ่ม Next จริงๆ บนหน้าจอ
    triggerFacebookNextFallback();

    // 4. แสดงเอฟเฟกต์กระพริบบนหน้าจอให้ผู้ใช้รู้ว่ากดสำเร็จ
    showFloatingPulse();
  } catch (err) {
    console.warn("[Sniffer] Key dispatch error:", err);
  }
}

/**
 * ค้นหาและคลิกปุ่ม Next ของ Facebook Photo Theater
 */
function triggerFacebookNextFallback() {
  if (!window.location.hostname.includes("facebook.com")) return;

  try {
    // รายชื่อ Selectors ของปุ่มถัดไปใน Facebook
    const selectors = [
      '[aria-label="ถัดไป"]',
      '[aria-label="Next"]',
      '[aria-label="Next photo"]',
      '[aria-label="รูปถัดไป"]',
      'div[role="button"][aria-label*="ถัดไป"]',
      'div[role="button"][aria-label*="Next"]',
      '[data-testid="next_button"]'
    ];

    for (const sel of selectors) {
      const btns = Array.from(document.querySelectorAll(sel));
      const visible = btns.find((b) => b.offsetParent !== null || b.getBoundingClientRect().width > 0);
      if (visible) {
        visible.click();
        return;
      }
    }

    // หากไม่พบด้วย aria-label ให้ตรวจหาปุ่มลูกศรขวาที่อยู่ฝั่งขวาของหน้าจอ (x > 50% ของหน้าจอ)
    const allButtons = Array.from(document.querySelectorAll('div[role="button"]'));
    const rightSideBtn = allButtons.find((b) => {
      const rect = b.getBoundingClientRect();
      return (
        rect.width > 20 && rect.height > 20 &&
        rect.left > window.innerWidth * 0.55 &&
        rect.top > window.innerHeight * 0.3 &&
        rect.top < window.innerHeight * 0.7
      );
    });

    if (rightSideBtn) {
      rightSideBtn.click();
    }
  } catch {}
}

/**
 * เริ่มระบบกดปุ่มลูกศรขวาอัตโนมัติ
 */
function startAutoSlide(intervalMs = 1800) {
  stopAutoSlide();
  slideIntervalMs = Math.max(700, intervalMs);
  isAutoSlideActive = true;

  // กดครั้งแรกทันที
  pressArrowRightKey();
  createOrUpdateFloatingPill(true);

  autoSlideTimer = setInterval(() => {
    if (!isAutoSlideActive) {
      clearInterval(autoSlideTimer);
      return;
    }
    pressArrowRightKey();

    chrome.runtime.sendMessage({
      type: "FB_SLIDE_TICK",
      timestamp: Date.now()
    }).catch(() => {});
  }, slideIntervalMs);
}

/**
 * หยุดระบบกดอัตโนมัติ
 */
function stopAutoSlide() {
  if (autoSlideTimer) {
    clearInterval(autoSlideTimer);
    autoSlideTimer = null;
  }
  isAutoSlideActive = false;
  createOrUpdateFloatingPill(false);
}

/**
 * สร้าง / อัปเดต Floating Status Pill บนหน้าจอเว็บ
 */
function createOrUpdateFloatingPill(active) {
  if (!floatingPill) {
    floatingPill = document.createElement("div");
    floatingPill.id = "sniffer-auto-slide-pill";
    floatingPill.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(8px);
      color: #f8fafc;
      border: 1px solid rgba(59, 130, 246, 0.4);
      padding: 6px 14px;
      border-radius: 9999px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11.5px;
      font-weight: 600;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      transition: all 0.2s ease;
    `;

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "⏹️ หยุด";
    stopBtn.style.cssText = `
      background: #ef4444; color: #fff; border: none;
      border-radius: 9999px; padding: 2px 8px; font-size: 10.5px;
      font-weight: 700; cursor: pointer;
    `;
    stopBtn.onclick = () => {
      stopAutoSlide();
      chrome.runtime.sendMessage({ type: "FB_AUTO_SLIDE_STOPPED_BY_USER" }).catch(() => {});
    };

    floatingPill.appendChild(document.createElement("span"));
    floatingPill.appendChild(stopBtn);
    document.body.appendChild(floatingPill);
  }

  if (active) {
    floatingPill.style.display = "flex";
    floatingPill.querySelector("span").innerHTML = `⚡ <b>Auto-Slide เปิดอยู่</b> (ชี้เมาส์ที่รูปภาพ • ${(slideIntervalMs/1000).toFixed(1)}s)`;
  } else {
    floatingPill.style.display = "none";
  }
}

function showFloatingPulse() {
  if (floatingPill && isAutoSlideActive) {
    floatingPill.style.borderColor = "#10b981";
    setTimeout(() => {
      if (floatingPill) floatingPill.style.borderColor = "rgba(59, 130, 246, 0.4)";
    }, 300);
  }
}

// ============================================================================
// Message Listener รับคำสั่งจาก Side Panel
// ============================================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FB_TRIGGER_NEXT") {
    pressArrowRightKey();
    sendResponse({ status: "ok" });
    return true;
  }

  if (msg.type === "FB_START_AUTO_SLIDE") {
    const interval = msg.intervalMs || 1800;
    startAutoSlide(interval);
    sendResponse({ status: "started", intervalMs: interval });
    return true;
  }

  if (msg.type === "FB_STOP_AUTO_SLIDE") {
    stopAutoSlide();
    sendResponse({ status: "stopped" });
    return true;
  }

  if (msg.type === "FB_GET_STATUS") {
    sendResponse({
      isAutoSlideActive,
      intervalMs: slideIntervalMs,
      title: document.title,
      url: window.location.href
    });
    return true;
  }
});

// หากผู้ใช้กด Escape บนหน้าเว็บ ให้หยุดการทำงาน
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isAutoSlideActive) {
    stopAutoSlide();
    chrome.runtime.sendMessage({ type: "FB_AUTO_SLIDE_STOPPED_BY_USER" }).catch(() => {});
  }
});

// ============================================================================
// Smart Page Video Extractor (ดึง Full HD/SD MP4 จาก Facebook Reels, Shopee, และ Web)
// ============================================================================
const extractedVideoUrls = new Set();

function cleanMediaUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let url = raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&").trim();
  // ตัด byte range parameters เพื่อให้ได้ URL ของไฟล์ตัวเต็ม
  try {
    const u = new URL(url);
    if (u.searchParams.has("bytestart") || u.searchParams.has("byteend")) {
      u.searchParams.delete("bytestart");
      u.searchParams.delete("byteend");
      url = u.href;
    }
  } catch {}
  return url;
}

function scanAndExtractPageVideos() {
  const foundUrls = new Set();

  // 1. ตรวจสอบ OpenGraph / Twitter Meta Tags
  const metaSelectors = [
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[name="twitter:player:stream"]'
  ];
  for (const sel of metaSelectors) {
    const el = document.querySelector(sel);
    const content = el?.getAttribute("content");
    if (content && content.startsWith("http") && (content.includes(".mp4") || content.includes(".webm"))) {
      const cleaned = cleanMediaUrl(content);
      if (cleaned) foundUrls.add(cleaned);
    }
  }

  // 2. ตรวจสอบแท็ก <video src="..."> และ <source src="..."> แท้ที่ไม่ใช่ blob:
  const videoElements = document.querySelectorAll("video, video source");
  videoElements.forEach((el) => {
    const src = el.src || el.getAttribute("src");
    if (src && src.startsWith("http") && !src.startsWith("blob:") && !src.startsWith("data:")) {
      if (src.includes(".mp4") || src.includes(".webm")) {
        const cleaned = cleanMediaUrl(src);
        if (cleaned) foundUrls.add(cleaned);
      }
    }
  });

  // 3. สแกน Script Tags และ Facebook Internal Relay Data (browser_native_hd_url, playable_url_quality_hd)
  const scripts = document.querySelectorAll("script");
  scripts.forEach((s) => {
    const text = s.textContent;
    if (!text || text.length < 50) return;

    if (text.includes("browser_native_hd_url") || text.includes("playable_url_quality_hd") || text.includes("browser_native_sd_url") || text.includes("playable_url") || text.includes("hd_src")) {
      const regex = /"(?:browser_native_hd_url|playable_url_quality_hd|browser_native_sd_url|playable_url|hd_src|sd_src)"\s*:\s*"([^"]+)"/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const cleaned = cleanMediaUrl(match[1]);
        if (cleaned && cleaned.startsWith("http")) {
          foundUrls.add(cleaned);
        }
      }
    }
  });

  // 4. ส่ง URL ที่พบไปยัง background.js (O(1) lookups)
  foundUrls.forEach((url) => {
    if (!extractedVideoUrls.has(url)) {
      extractedVideoUrls.add(url);
      chrome.runtime.sendMessage({
        type: "ADD_PAGE_EXTRACTED_MEDIA",
        url: url,
        resourceType: "media",
        contentType: "video/mp4"
      }).catch(() => {});
    }
  });
}

// สแกนเมื่อโหลดหน้าเว็บ, เลื่อนหน้าจอ, หรือ DOM เปลี่ยนแปลง (Debounced O(1))
let scanTimer = null;
function debouncedScanVideos() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(scanAndExtractPageVideos, 400);
}

window.addEventListener("load", debouncedScanVideos);
window.addEventListener("scroll", debouncedScanVideos, { passive: true });
document.addEventListener("DOMContentLoaded", debouncedScanVideos);

const videoDomObserver = new MutationObserver(() => {
  debouncedScanVideos();
});
if (document.body) {
  videoDomObserver.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener("DOMContentLoaded", () => {
    if (document.body) {
      videoDomObserver.observe(document.body, { childList: true, subtree: true });
    }
  });
}




