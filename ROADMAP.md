# 🗺️ SniffLens: Product Roadmap & Technical Architecture Plan

This document outlines the strategic roadmap, architectural specifications, and implementation phases for **SniffLens (Network Image Sniffer & AI Toolkit)**.

---

## 📌 Milestone Status Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             SniffLens Release Pipeline                           │
├───────────────────────┬──────────────────────────┬───────────────────────────────┤
│ ✅ Completed (v3.1.0) │ ⏳ Phase 2 (v3.2.0)      │ 🔮 Phase 3 (v3.5.0)           │
│ Production Ready      │ Next Sprint              │ Cloud & Distribution          │
│ • Network Sniffer     │ • On-Device AI BG Removal│ • Chrome Web Store CI/CD      │
│ • Macro Studio (Keys) │ • Local OCR Text Parser  │ • Direct Google Drive / S3    │
│ • Multi-Tab Isolation │ • Smart Image Upscaler   │ • Discord / Telegram Webhook  │
│ • HLS Video Stitcher  │ • Vision Dataset Parser  │ • Automated E2E Test Suite    │
│ • In-Memory Blob Save │ • AI Auto-Tagging        │ • Auto-Package Releases       │
└───────────────────────┴──────────────────────────┴───────────────────────────────┘
```

---

## 🎯 Phase 1.5 (v3.1.0): Multi-Block Hardware Key Macro Studio `[✅ COMPLETED]`
- **Universal Directional Keys**: Native simulation of `ArrowRight`, `ArrowDown`, `ArrowLeft`, `ArrowUp`, `PageDown`, `Spacebar`.
- **Multi-Block Visual Sequence Chain**: Chaining multiple action blocks with independent per-block delay configuration.
- **In-Memory Blob Download Pipeline**: Guarantees 100% reliable `.mp4` downloads across TikTok, Facebook Reels, and Instagram without 403 Forbidden or `.htm` errors.
- **Chrome Debugger Protocol Execution**: Dispatches 100% genuine `isTrusted: true` hardware events.



### 1. Problem Statement
Modern platforms (Facebook, Shopee, TikTok, Instagram, Twitter) split high-definition videos into 1-to-2-second chunk segments (`.ts` or `.m4s`) governed by master playlist files (`.m3u8` or `.mpd`). Direct network sniffing only captures single isolated chunks instead of the full video.

### 2. Technical Architecture
```
┌────────────────────────────────────────────────────────────────────────┐
│                   HLS Video Stitcher Implementation                    │
├────────────────────────────────────────────────────────────────────────┤
│ 1. 📡 Manifest Interceptor (background.js)                             │
│    - Detect .m3u8 / .mpd playlist URLs from chrome.webRequest          │
│    - Parse playlist text to extract ordered list of segment chunk URLs │
│                                                                        │
│ 2. ⚡ Concurrency Downloader (Web Worker)                              │
│    - Fetch chunks in parallel (concurrency limit = 6-8 streams)        │
│    - Manage array of binary ArrayBuffers in sequence order             │
│                                                                        │
│ 3. 🧵 Binary Stitcher & Muxer                                          │
│    - Concatenate Uint8Array chunks into a unified video payload        │
│    - Generate download Blob: new Blob(chunks, { type: 'video/mp4' })   │
│                                                                        │
│ 4. 📊 Real-Time Progress UI (panel.html)                               │
│    - Live progress overlay: "Stitching Chunks: 35/120 (29%)"           │
│    - Instant cancellation and memory garbage collection                │
└────────────────────────────────────────────────────────────────────────┘
```

### 3. Implementation Steps:
1. **Playlist Parser Module (`hls-parser.js`)**:
   - Parses `#EXTINF` tags, resolution streams, and resolves relative chunk URLs.
2. **Chunk Worker Engine (`worker/chunk-fetcher.js`)**:
   - Offloads network fetch loops off the UI thread to prevent browser lag.
3. **Safety Guards**:
   - Limit max video duration / size (< 300 MB) to prevent browser tab out-of-memory crashes.
   - Ignore DRM-encrypted segments (`#EXT-X-KEY:METHOD=SAMPLE-AES`).

---

## 🤖 Phase 2 (v3.2.0): On-Device AI Image Pre-Processing Toolkit

### 1. Objective
Enable e-commerce sellers, researchers, and creators to prepare clean datasets and product mockups directly within the browser without uploading data to external servers.

### 2. Proposed Modules:
- **🪓 One-Click Background Remover (WASM)**:
  - Integrate `@imgly/background-removal` or lightweight ONNX Runtime Web.
  - Runs 100% on-device client-side; guarantees user privacy and offline functionality.
- **🔍 Intelligent OCR Text Extraction**:
  - Extract text overlay, prices, and specifications from captured product graphics.
- **✨ Smart Image Upscaler (2x / 4x)**:
  - Real-ESRGAN WebAssembly model to upscale low-res thumbnails to crisp high-res graphics.
- **🏷️ Vision AI Dataset Formatter**:
  - Auto-generate structured `dataset.jsonl` formatted for **Google Gemini 1.5** and **OpenAI GPT-4o** fine-tuning.

---

## 🌐 Phase 3 (v3.5.0): Chrome Web Store Packaging & Cloud Sync

### 1. Objective
Automate release workflows and enable direct integration with local processing servers or cloud storage.

### 2. Proposed Modules:
- **📦 Chrome Web Store Automated Pipeline**:
  - GitHub Actions workflow (`.github/workflows/deploy.yml`) for automated testing, linting, packaging, and deployment to the Chrome Web Store.
- **☁️ Cloud & Local Webhooks**:
  - **Local Server**: Direct POST webhook to Python (FastAPI / Flask) or Node.js running on `localhost:8000`.
  - **Cloud Bucket**: Export selected assets directly to Google Drive, Dropbox, or AWS S3.
- **⌨️ Customizable Global Hotkeys**:
  - Configurable keyboard shortcuts (e.g. `Alt + S` for Side Panel, `Alt + Right` for Auto-Slide step).

---

## 📐 Non-Functional Requirements & Engineering Standards

1. **Big-O Complexity Compliance**:
   - All collection lookups and deduplication must strictly operate at $O(1)$.
   - DOM renders must use `DocumentFragment` to guarantee $O(1 \times \text{Reflow})$.
   - Input search events must be throttled with a 150ms debounce window.
2. **Strict Manifest V3 Compliance**:
   - Stateless Service Worker architecture (`background.js`).
   - Ephemeral session memory managed via `chrome.storage.session` with automatic cleanup on `chrome.tabs.onRemoved`.
3. **Defensive Security & Privacy**:
   - Zero telemetry, zero external tracking, zero token leaks.
   - All processing runs locally inside the user's browser sandbox.

---

## 🤝 Contributing to the Roadmap

Have a feature suggestion or want to work on a milestone?
- Open a discussion or feature request on [GitHub Issues](https://github.com/ntaffzii/sniff-lens/issues).
- Check [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup instructions.
