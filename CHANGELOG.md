# 📝 Changelog

All notable changes to the **Network Image Sniffer & AI Toolkit (SniffLens)** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-08-23
### Added
- **Multi-Block Hardware Key Macro Studio**:
  - Full directional keyboard automation: **➡️ Right (`ArrowRight`)**, **⬇️ Down (`ArrowDown` for TikTok/Reels)**, **⬅️ Left (`ArrowLeft`)**, **⬆️ Up (`ArrowUp`)**, **⇟ `PageDown`**, and **␣ `Spacebar`**.
  - **Visual Sequence Chain Builder**: Create multi-step macro sequences (e.g. Step 1: Right 1.5s -> Step 2: Right 1.5s -> Step 3: Down 3.0s).
  - **Independent Delay Control**: Adjust wait time per action block individually in seconds.
  - **4 Built-in Quick Presets**:
    - 🖼️ Facebook Carousel (`ArrowRight` 1.8s)
    - 📱 TikTok / Reels Feed (`ArrowDown` 3.0s)
    - 🔲 Grid Album Explorer (3x `Right` 1.5s, 1x `Down` 2.5s)
    - 📰 Long Feed Scroller (`PageDown` 3.5s)
  - **Chrome Debugger Protocol Execution Engine**: 100% genuine `isTrusted: true` hardware events that bypass website bot detection.
  - **Direct Panel In-Memory Blob Downloader**: Guarantees zero HTTP 403 Forbidden or `.htm` download errors when capturing TikTok and Facebook videos.

---

## [3.0.0] - 2026-08-23

### Added
- **HLS Streaming Video Stitcher Engine (Phase 1 Complete)**:
  - Intercepts `.m3u8` master and media playlists directly from network traffic.
  - **Single-Pass $O(N)$ M3U8 Lexical Scanner**: Selects highest bitrate stream and parses ordered chunk segment URLs.
  - **$O(N/K)$ Concurrency Worker Pool (6 Streams)**: Downloads video chunks in parallel with $O(1)$ pre-allocated slot ingestion.
  - **Zero-Copy Binary Blob Muxer**: Assembles chunks in-memory into a unified `.mp4` video container with instant $O(1)$ RAM dereferencing.
  - **Live Stitching Progress Banner**: Real-time progress percentage (`34/110 Chunks - 31%`) with instant cancellation support.
  - **Interactive Stream Inspection in Lightbox**: View streaming metadata and trigger 1-click video stitching and downloading.

---

## [2.7.0] - 2026-08-23
### Added
- **Selective Media Capture Toggles (Images / Standalone MP4)**:
  - Settings switches to selectively enable/disable image or video network sniffing per tab.
- **Smart Standalone MP4 Video Filter Engine**:
  - Automatically detects and captures genuine unencrypted standalone `.mp4` / `.webm` media (> 50 KB).
  - Automatically filters out streaming chunk segments (`.m4s`, `.ts`, `.m3u8`, `.mpd`, Init chunks) to prevent black cards and preview errors.
  - Added filter for micro tracking pixels / spacer GIFs (< 30 bytes).
- **Interactive Video Preview & Lightbox Player**:
  - Seamlessly renders playable `<video>` controls in Fullscreen Lightbox Modal and thumbnail grids.

---

## [2.6.3] - 2026-08-23
### Added
- **Official Squircle App Icon Branding**: Modern rounded square app icon (`16x16` to `512x512` px) with dual neon emerald/cyan border and transparent exterior corners.
- Integrated branding across Side Panel Header, Settings Modal, and Popup menu.

---

## [2.6.0] - 2026-08-23
### Added
- **Multi-Tab & Per-Site Settings Isolation Engine**:
  - Independent profile storage (`tab_settings_${tabId}`) in Session Storage.
  - Subfolder, Prefix, and Starting Number no longer collide across tabs/posts.
  - Automatic Tab Sync on `chrome.tabs.onActivated`.
  - Option to save active settings as Global Defaults for future new tabs.
  - Automatic session cleanup on tab closure (`chrome.tabs.onRemoved`).

---

## [2.5.0] - 2026-08-23
### Added
- **Custom Starting Sequence Number (`startNumber`)**:
  - Configurable sequence offset (e.g. start at `51`, `101`, `250`).
  - Real-time filename preview calculation in Settings Modal.
  - Seamless integration with Batch Download and Single Lightbox rename.

---

## [2.4.0] - 2026-08-23
### Added
- **Chrome Native Hardware Key Engine (`isTrusted = true`)**:
  - Leveraged Chrome Debugger Protocol (`Input.dispatchKeyEvent`) for authentic hardware key simulation (`ArrowRight` KeyCode 39).
  - 100% bypasses React 18 / Meta framework security filters on Facebook photo theater and universal image carousels.
  - Universal Pointer fallback for background clicks.
  - Auto-Slide loop manager with speed customization (0.8s - 3.5s).

---

## [2.2.0] - 2026-08-23
### Added
- **Batch Download Confirmation Modal**:
  - Preview dialog displaying total file count, destination folder, and filename range (`image_001.jpg` to `image_075.jpg`).
  - Clear guidance on how to disable Chrome's "Ask where to save each file" prompt.
  - Live progress bar banner with instant cancellation button (`CANCEL_BATCH`).

---

## [2.0.0] - 2026-08-23
### Added
- **Smart 4-Tier Deduplication Engine**:
  - URL Normalization (stripping tracking query tokens like `?_nc_*`, `?token=...`).
  - HTTP ETag header matching.
  - Content fingerprinting (Pathname + Content-Length validation).
  - Pre-download duplicate prevention.
- **Custom Folder Subdirectory Routing**:
  - Custom path within `Downloads/` folder with quick presets (Domain, Date, Default).
- **Sequential Filename Template System**:
  - `{prefix}_{num3}`, `{num2}`, `{num}`, `{date}`, `{domain}`, `{orig}`.
- **Fullscreen Lightbox Viewer**:
  - Dimensions reader (`1920x1080`), file size, MIME type badge, single filename inline renamer, and keyboard navigation.

---

## [1.0.0] - 2026-08-22
### Added
- Initial release of Network Image Sniffer (Manifest V3).
- Real-time `chrome.webRequest` media stream sniffing.
- Chrome Side Panel UI with live count badge and filter controls.
