<p align="center">
  <img src="icons/icon-128.png" width="100" height="100" alt="SniffLens Logo" />
</p>

<h1 align="center">⚡ Network Image Sniffer & AI Toolkit (SniffLens)</h1>

<p align="center">
  <b>ส่วนขยาย Chrome & Brave ระดับโปร (Manifest V3) สำหรับดักจับภาพและวิดีโอระดับ Network Layer, ระบบ Native Hardware Key Auto-Slide, แยก Profile การตั้งค่าตามแท็บอิสระ และเครื่องมือเตรียมข้อมูลสำหรับ Vision AI</b>
</p>

<p align="center">
  <a href="./README.md"><b>[ 🌐 English Version / เอกสารภาษาอังกฤษ ]</b></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-emerald?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Chrome_%26_Brave-Supported-blue?style=flat-square&logo=brave&logoColor=white" alt="Browser" />
  <img src="https://img.shields.io/badge/Version-2.7.0-indigo?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
</p>

---

## 🌟 จุดเด่นของโปรเจกต์ (Key Features)

| ฟีเจอร์ | คำอธิบาย |
| :--- | :--- |
| **⚡ Network Layer Sniffing** | ดักจับไฟล์รูปภาพ (JPEG, PNG, WEBP, SVG, GIF) ระดับ Traffic จริงที่เบราว์เซอร์ดาวน์โหลด ไม่พลาดรูปความละเอียดสูง |
| **🎥 Smart Standalone MP4 Filter** | ดักจับเฉพาะไฟล์วิดีโอ `.mp4` / `.webm` แท้ที่ไม่เข้ารหัส พร้อมกรองเศษไฟล์สตรีมมิ่ง (.m4s, .ts, .m3u8, .mpd) ทิ้งอัตโนมัติ 100% |
| **🎯 Selective Media Toggles** | สวิตช์เปิด/ปิด ในหน้าตั้งค่า สามารถเลือกดักจับเฉพาะรูปภาพ หรือเฉพาะวิดีโอ แยกตามแต่ละแท็บได้อย่างอิสระ |
| **⚡ Native Hardware Key Auto-Slide** | จำลองการกดปุ่มลูกศรขวา (`ArrowRight`) ผ่าน **Chrome Debugger Protocol** ได้อีเวนต์ `isTrusted = true` แท้ 100% เลื่อนดูรูปบน Facebook Photo Theater และเว็บต่างๆ ได้อัตโนมัติ |
| **📌 Multi-Tab & Per-Site Isolation** | แยก Profile การตั้งค่าโฟลเดอร์ คำนำหน้า และเลขลำดับตามแต่ละแท็บ/โพสต์อิสระ 100% สลับแท็บแล้วโหลดค่าของแท็บนั้นทันที ไม่ทับซ้อนกัน |
| **🛡️ 4-Tier Smart Deduplication** | ป้องกันรูปซ้ำ 4 ระดับ (URL Normalization, ETag Matching, Content Fingerprinting, Pre-download Guard) เลื่อนฟีดแค่ไหนก็ไม่นับรูปเดิม |
| **🔢 Sequential Naming & Start Number** | กำหนดรูปแบบชื่อไฟล์ผ่าน Template (`{prefix}_{num3}`) พร้อมเลือก **เลขเริ่มต้น (Start Number)** เช่น เริ่มต้นที่ `51`, `101` เพื่อโหลดต่อเนื่อง |
| **📁 Custom Subdirectory Routing** | กำหนดโฟลเดอร์ย่อยใน `Downloads/` ได้อิสระ พร้อมปุ่ม Preset ตามชื่อเว็บและวันที่ |
| **🖼️ Fullscreen Lightbox Modal** | ดูรูปขนาดเต็มหรือเล่นวิดีโอ พร้อมแสดง Dimension (`1920×1080`), ขนาดไฟล์, MIME type, เปลี่ยนชื่อไฟล์เดี่ยวก่อนโหลด และคัดลอก URL ทันใจ |
| **💾 Batch Download & Safety Guard** | หน้าต่างเตือนยืนยันก่อนโหลดแบบกลุ่ม แสดงช่วงชื่อไฟล์ พร้อม Progress Bar แบบเรียลไทม์ และปุ่มกดยกเลิกคิวได้ทันที |
| **🤖 Vision AI Toolkit** | คู่มือและโค้ดพร้อมใช้ใน [`AI_INTEGRATION.md`](./AI_INTEGRATION.md) สำหรับเชื่อมต่อไปยัง **Google Gemini Vision**, **OpenAI GPT-4o** และ **Ollama** |

---

## 🏗️ สถาปัตยกรรมระบบ (System Architecture)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Chrome / Brave Browser                          │
├───────────────────────────────────┬────────────────────────────────────┤
│ 🌐 Active Web Page (Facebook/Web)  │ 📱 Extension Side Panel UI         │
│ • Network Request (High-Res Image)│ • Live Grid Gallery & Filters      │
│ • React 18 / Meta Photo Theater   │ • Multi-Tab Scoped Profile Manager │
│ • Hardware Key Receiver (isTrusted│ • Fullscreen Lightbox & Renamer    │
└─────────────────┬─────────────────┴─────────────────▲──────────────────┘
                  │                                   │
                  ▼                                   │ (State Sync)
┌─────────────────────────────────────────────────────┴──────────────────┐
│              Background Service Worker Engine (MV3)                    │
│ ├─ chrome.webRequest (Media Stream Interceptor & 4-Tier Deduplicator)  │
│ ├─ chrome.debugger (Input.dispatchKeyEvent -> 100% isTrusted Events)  │
│ ├─ chrome.storage.session (Tab-Scoped Storage & Memory Management)    │
│ └─ chrome.downloads (Sequential Batch Queue & Subfolder Router)        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 วิธีติดตั้งและเริ่มต้นใช้งาน (Installation)

1. **Clone หรือดาวน์โหลดโปรเจกต์นี้**:
   ```bash
   git clone https://github.com/ntaffzii/sniff-lens.git
   ```
2. **เปิดหน้าจัดการส่วนขยายในเบราว์เซอร์**:
   - พิมพ์ `chrome://extensions` (หรือ `brave://extensions`) ในช่อง Address Bar
3. **เปิดโหมดนักพัฒนา (Developer mode)**:
   - ติ๊กเปิดสวิตช์ **Developer mode** ที่มุมขวาบน
4. **ติดตั้งส่วนขยาย**:
   - คลิกปุ่ม **Load unpacked (โหลดส่วนขยายที่คลายการบีบอัดแล้ว)**
   - เลือกโฟลเดอร์โปรเจกต์นี้ (`image-capture-ext`)
5. **ปักหมุดไอคอน**:
   - คลิกไอคอนรูปจิ๊กซอว์บนแถบเครื่องมือของเบราว์เซอร์ แล้วกดปักหมุด **Network Image Sniffer & AI Toolkit**

---

## 📖 คู่มือการใช้งาน (User Guide)

### 1. การเปิดใช้งาน Side Panel
- คลิกที่ไอคอนของส่วนเสริมบน Toolbar หรือคลิกปุ่ม **"🖼️ Open Side Panel"** เพื่อเปิดแผงควบคุมด้านข้าง

### 2. การใช้งานระบบ Native Auto-Slide (สำหรับ Facebook และเว็บรูปภาพ)
1. เปิดภาพใน Facebook ให้เป็นหน้าต่างขยายรูปภาพ (Photo Theater)
2. บนแถบ **⚡ Native Auto-Slide** ใน Side Panel:
   - เลือกความเร็วที่ต้องการ (เช่น `1.8s` หรือ `2.2s`)
   - คลิกปุ่ม **`[ ▶️ Auto-Play ]`**
   - ระบบจะส่งสัญญาณคีย์บอร์ดฮาร์ดแวร์แท้กดปุ่ม `[→]` เลื่อนรูปภาพไปเรื่อยๆ พร้อมดักจับภาพความละเอียดสูงเข้าสู่ Side Panel ทันที
   - คลิก **`[ ⏸️ Stop ]`** เมื่อต้องการหยุด

### 3. การตั้งค่าโฟลเดอร์, คำนำหน้า และเลขเริ่มต้น (Settings)
1. คลิกปุ่ม **"⚙️ Settings"** บนแถบด้านบน
2. กำหนดค่าตามต้องการ:
   - **Destination Subfolder**: เช่น `captured/album-ploen`
   - **Filename Template**: `{prefix}_{num3}` ➔ `image_001.jpg`
   - **Filename Prefix**: เช่น `photo-ploen`
   - **Starting Sequence Number**: เช่น `51` (เพื่อให้ไฟล์เริ่มรันที่ `photo-ploen_051.jpg`)
3. สังเกตตัวอย่างชื่อไฟล์ในกล่อง **Live Preview**
4. กด **"💾 Save Settings"**

### 4. การดาวน์โหลดรูปภาพ (Batch & Single Download)
- **โหลดรูปเดี่ยว**: คลิกที่รูปภาพเพื่อเปิดหน้าต่าง **Lightbox** สามารถแก้ไขชื่อไฟล์เฉพาะรูปนั้นแล้วกด **"💾 Download Image"**
- **โหลดแบบเลือกรูป**: ติ๊กถูกที่รูปภาพที่ต้องการ แล้วกดปุ่ม **"💾 Download Selected"**
- **โหลดทั้งหมด**: คลิกปุ่ม **"⚡ Download All"** ➔ ตรวจสอบข้อมูลในหน้าต่างยืนยัน ➔ กด **"⚡ Start Batch Download"**

> 💡 **คำแนะนำ**: หากต้องการไม่ให้ Chrome ถามตำแหน่งเซฟไฟล์ทุกรูป ให้ไปที่ `chrome://settings/downloads` แล้ว **ปิด (Disable)** ตัวเลือก *"Ask where to save each file before downloading"*

---

## 🤖 การเชื่อมต่อ Vision AI (AI Integration)

โปรเจกต์นี้ออกแบบมาเพื่อรองรับการดึงรูปภาพเข้าสู่ AI Pipelines ได้ทันที ศึกษาโค้ดตัวอย่างใน [`AI_INTEGRATION.md`](./AI_INTEGRATION.md):
- **Google Gemini 1.5 Pro / Flash**: Image Captioning, OCR, และ Data Extraction
- **OpenAI GPT-4o**: Multi-modal Visual Analysis
- **Local AI (Ollama / LLaVA)**: ประมวลผลรูปภาพแบบ Offline ในเครื่อง
- **Node.js / Python Batch Webhook**: ส่งภาพเข้าคลังประมวลผลอัตโนมัติ

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```
network-image-sniffer/
├── manifest.json         # การกำหนดค่าส่วนขยาย Manifest V3 & สิทธิ์การทำงาน
├── background.js         # Service Worker ดักจับ Network, Chrome Debugger และคิวดาวน์โหลด
├── content.js            # Content Script ตรวจจับ Pointer และ DOM Event
├── panel.html            # UI หลักของ Side Panel, Lightbox และ Settings Dialog
├── panel.js              # Controller จัดการคลังภาพ, Multi-Tab Profile และ Batch Downloader
├── popup.html            # UI เมนูป๊อปอัปย่อบน Toolbar
├── popup.js              # Controller ของ Popup
├── icons/                # ชุดไฟล์ไอคอน Squircle หลากหลายขนาด (16, 32, 48, 128, 256, 512)
├── AI_INTEGRATION.md     # คู่มือและสคริปต์เชื่อมต่อโมเดล Vision AI
├── CHANGELOG.md          # บันทึกประวัติการอัปเกรดเวอร์ชัน
├── CONTRIBUTING.md       # ข้อกำหนดและแนวทางการร่วมพัฒนา
├── LICENSE               # สัญญาอนุญาตซอฟต์แวร์ MIT License
├── README_TH.md          # เอกสารคู่มือภาษาไทย
└── README.md             # เอกสารคู่มือภาษาอังกฤษสากล
```

---

## 📄 ใบอนุญาต (License)

โปรเจกต์นี้เผยแพร่ภายใต้สัญญาอนุญาต **[MIT License](LICENSE)** สามารถนำไปใช้งาน พัฒนาต่อยอด หรือดัดแปลงได้อย่างอิสระ
