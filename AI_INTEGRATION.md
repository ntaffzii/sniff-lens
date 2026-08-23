# คู่มือการเชื่อมต่อและต่อยอดกับ AI (AI Integration Guide)

เอกสารนี้อธิบายสถาปัตยกรรมและวิธีการนำรูปภาพที่ดักจับได้จาก **Network Image Sniffer** ไปประมวลผลต่อร่วมกับระบบปัญญาประดิษฐ์ (AI Models & Agents) เช่น Google Gemini, OpenAI GPT-4o, Local AI (Ollama / LLaVA), หรือ Webhook Backend API

---

## 1. รูปแบบโครงสร้างข้อมูล (Data Schema with Deduplication Fingerprint)

ข้อมูลรูปภาพทุกไฟล์ที่ Extension ดักจับได้และเก็บไว้ใน `chrome.storage.session` ผ่านการกรองรูปซ้ำ 4 ระดับ (Smart Deduplication) จะมีโครงสร้าง JSON มาตรฐานดังนี้:

```json
{
  "id": "cap_1724385100123_a9b8c",
  "url": "https://example.com/images/product_highres.jpg",
  "normalizedUrl": "https://example.com/images/product_highres.jpg",
  "etag": "33a64df551425fcc55e4d42a148795d9f25f89d4",
  "fingerprint": "etag_33a64df551425fcc55e4d42a148795d9f25f89d4",
  "targetFilename": "product_001.jpg",
  "resourceType": "image",
  "contentType": "image/jpeg",
  "size": 430080,
  "width": 1920,
  "height": 1080,
  "statusCode": 200,
  "timestamp": 1724385100123
}
```

> **ข้อดีของฟิลด์ `targetFilename` และ `fingerprint`**:
> เมื่อนำข้อมูลชุดนี้ส่งต่อไปยัง AI Batch Pipeline คุณจะได้ชื่อไฟล์ที่เรียงลำดับอย่างเป็นระเบียบ เช่น `product_001.jpg`, `product_002.jpg` พร้อมทั้งรับประกันว่าจะไม่มีรูปภาพที่ซ้ำซ้อนส่งไปเปลือง Token ของ AI

---

## 2. วิธีแปลง URL รูปภาพเป็น Base64 (Helper Function)


ในการส่งภาพไปยัง AI APIs ส่วนใหญ่ มักจำเป็นต้องแปลงภาพเป็น Base64 Data URL เพื่อส่งใน Request Body:

```javascript
/**
 * ดาวน์โหลดรูปภาพจาก URL แล้วแปลงเป็น Base64
 * @param {string} imageUrl URL ของรูปภาพ
 * @returns {Promise<{base64Data: string, mimeType: string}>}
 */
async function imageUrlToBase64(imageUrl) {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result;
      // ตัด prefix 'data:image/jpeg;base64,' ออกเพื่อให้ได้เฉพาะ raw base64
      const base64Data = base64String.split(",")[1];
      resolve({
        base64Data,
        mimeType: blob.type || "image/jpeg"
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

---

## 3. ตัวอย่างการเชื่อมต่อกับ Google Gemini API (Multimodal / OCR / Visual QA)

ใช้โมเดล **Gemini 1.5 Flash** หรือ **Gemini 2.0 Flash** สำหรับอ่านข้อความในรูปภาพ (OCR), สรุปรูปภาพ, ตรวจจับวัตถุ หรือแยกประเภทสินค้า:

```javascript
/**
 * ส่งภาพไปวิเคราะห์ด้วย Google Gemini API
 * @param {string} imageUrl URL ของรูปที่ดักจับได้
 * @param {string} prompt คำสั่ง prompt เช่น "อ่านข้อความภาษาไทยทั้งหมดในภาพนี้"
 * @param {string} apiKey Google Gemini API Key
 */
async function analyzeWithGemini(imageUrl, prompt, apiKey) {
  const { base64Data, mimeType } = await imageUrlToBase64(imageUrl);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ]
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  const answerText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return answerText;
}

// ตัวอย่างการเรียกใช้:
// const result = await analyzeWithGemini(
//   item.url,
//   "ช่วยสกัดรายละเอียดสินค้า ชื่อ ราคา และคุณสมบัติจากภาพนี้ในรูปแบบ JSON",
//   "YOUR_GEMINI_API_KEY"
// );
// console.log("ผลลัพธ์จาก AI:", result);
```

---

## 4. ตัวอย่างการเชื่อมต่อกับ Local AI (Ollama + LLaVA / Moondream)

เหมาะสำหรับการประมวลผลบนเครื่องคอมพิวเตอร์ของคุณเองโดยตรง **(Privacy-first / ฟรี 100% / ไม่ต้องต่ออินเทอร์เน็ต)**:

1. ติดตั้ง Ollama และดึงโมเดล Vision:
   ```bash
   ollama run llava
   # หรือสำหรับเครื่องสเปกเบา
   ollama run moondream
   ```
2. โค้ด JavaScript ยิงเข้า Local Endpoint (`http://localhost:11434`):

```javascript
/**
 * ส่งภาพไปประมวลผลที่ Ollama Local Vision Model
 */
async function analyzeWithLocalOllama(imageUrl, prompt, model = "llava") {
  const { base64Data } = await imageUrlToBase64(imageUrl);

  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      images: [base64Data],
      stream: false
    })
  });

  const data = await response.json();
  return data.response;
}
```

---

## 5. ตัวอย่างการเชื่อมต่อกับ OpenAI (GPT-4o Vision)

```javascript
async function analyzeWithOpenAI(imageUrl, prompt, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ],
      max_tokens: 600
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content;
}
```

---

## 6. ตัวอย่างการส่งออกเป็นชุดไปยัง Webhook / Python Backend (Batch Processing)

หากต้องการนำภาพที่ดักจับได้ทั้งหมดส่งไปยัง Backend เช่น FastAPI, Node.js หรือ n8n/Make:

```javascript
async function exportBatchToWebhook(webhookUrl, selectedItems) {
  const payload = {
    exportedAt: new Date().toISOString(),
    totalCount: selectedItems.length,
    media: selectedItems.map((item) => ({
      url: item.url,
      mimeType: item.contentType,
      size: item.size,
      dimensions: { width: item.width, height: item.height }
    }))
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return res.ok;
}
```

---

## 7. Prompt Templates ยอดนิยมสำหรับงาน Vision AI

| งานที่ต้องการทำ | Prompt แนะนำ |
| :--- | :--- |
| **อ่านข้อความในภาพ (OCR)** | `"โปรดอ่านและคัดลอกข้อความทั้งหมดที่ปรากฏในรูปภาพนี้อย่างแม่นยำ โดยจัดรูปแบบบรรทัดให้ตรงกับภาพต้นฉบับ"` |
| **สกัดข้อมูลสินค้า E-Commerce** | `"วิเคราะห์ภาพนี้และสกัดข้อมูลสินค้าออกมาเป็น JSON schema: { productName, brand, priceEstimate, color, keyFeatures: [] }"` |
| **อธิบายรูปภาพสำหรับคนตาบอด / Alt text** | `"เขียนคำบรรยาย alt text สั้นกระชับ อธิบายองค์ประกอบสำคัญและบริบทในภาพนี้เพื่อประโยชน์ในการเข้าถึง (Accessibility)"` |
| **ตรวจจับและตรวจสอบความปลอดภัย (Moderation)** | `"ประเมินว่าภาพนี้มีเนื้อหาที่ไม่เหมาะสม ลามกอนาจาร หรือความรุนแรงหรือไม่ ตอบในรูปแบบ { isSafe: boolean, categories: [] }"` |

---

## 8. วิธีเพิ่มปุ่ม "🤖 ส่งให้ AI" ใน Side Panel (Frontend Extension)

คุณสามารถเพิ่มปุ่มใน `panel.html` ที่ Lightbox Action Bar ได้โดยตรง:

```html
<!-- เพิ่มใน panel.html ใต้ .lightbox-actions -->
<button id="lightbox-ai-btn" class="btn-secondary" style="background: #4f46e5; color: #fff;">
  🤖 วิเคราะห์ด้วย AI
</button>
```

และใน `panel.js`:
```javascript
document.getElementById("lightbox-ai-btn").onclick = async () => {
  const item = filteredItemsCache[currentLightboxIndex];
  if (!item) return;
  
  showToast("⏳ กำลังส่งภาพให้ AI วิเคราะห์...");
  try {
    // เรียกใช้ฟังก์ชัน analyzeWithGemini หรือ analyzeWithLocalOllama ที่ต้องการ
    const result = await analyzeWithGemini(item.url, "อธิบายภาพนี้สั้นๆ 1 ย่อหน้า", "YOUR_API_KEY");
    alert("🤖 ผลการวิเคราะห์จาก AI:\n\n" + result);
  } catch (err) {
    showToast("❌ เกิดข้อผิดพลาดในการเรียก AI");
    console.error(err);
  }
};
```
