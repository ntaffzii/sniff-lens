// ============================================================================
// SniffLens ISO-BMFF Fast MP4 Video + Audio Remuxer Engine (v3.2.0)
// High-Performance In-Browser Binary Stream Remuxer (Zero Re-Encoding, O(N))
// ============================================================================

/**
 * ISO-BMFF Box Parser & Binary Reader
 */
class MP4BoxReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.pos = 0;
  }

  readUint32() {
    const val = this.view.getUint32(this.pos);
    this.pos += 4;
    return val;
  }

  readString(len = 4) {
    let str = "";
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(this.bytes[this.pos + i]);
    }
    this.pos += len;
    return str;
  }

  getBoxes(startOffset = 0, endOffset = this.buffer.byteLength) {
    const boxes = [];
    let offset = startOffset;

    while (offset < endOffset && offset + 8 <= endOffset) {
      const size = this.view.getUint32(offset);
      const type = String.fromCharCode(
        this.bytes[offset + 4],
        this.bytes[offset + 5],
        this.bytes[offset + 6],
        this.bytes[offset + 7]
      );

      const actualSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : (size === 0 ? endOffset - offset : size);
      if (actualSize <= 0 || offset + actualSize > endOffset) break;

      boxes.push({
        type,
        offset,
        size: actualSize,
        headerSize: size === 1 ? 16 : 8,
        payloadOffset: offset + (size === 1 ? 16 : 8),
        payloadSize: actualSize - (size === 1 ? 16 : 8)
      });

      offset += actualSize;
    }

    return boxes;
  }

  findBoxRecursive(boxes, targetType) {
    for (const box of boxes) {
      if (box.type === targetType) return box;
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(box.type)) {
        const subBoxes = this.getBoxes(box.payloadOffset, box.offset + box.size);
        const found = this.findBoxRecursive(subBoxes, targetType);
        if (found) return found;
      }
    }
    return null;
  }

  findAllBoxesRecursive(boxes, targetType, result = []) {
    for (const box of boxes) {
      if (box.type === targetType) result.push(box);
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(box.type)) {
        const subBoxes = this.getBoxes(box.payloadOffset, box.offset + box.size);
        this.findAllBoxesRecursive(subBoxes, targetType, result);
      }
    }
    return result;
  }
}

/**
 * ปรับ Chunk Offsets (stco / co64) ของ Audio Track เมื่อนำไปต่อท้าย Video mdat
 */
function shiftTrackOffsets(buffer, trakBox, offsetDelta) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const reader = new MP4BoxReader(buffer);

  const subBoxes = reader.getBoxes(trakBox.payloadOffset, trakBox.offset + trakBox.size);
  const stcoBox = reader.findBoxRecursive(subBoxes, "stco");
  const co64Box = reader.findBoxRecursive(subBoxes, "co64");

  if (stcoBox) {
    const entryCount = view.getUint32(stcoBox.payloadOffset + 4);
    let entryPos = stcoBox.payloadOffset + 8;
    for (let i = 0; i < entryCount; i++) {
      const currentOffset = view.getUint32(entryPos);
      view.setUint32(entryPos, currentOffset + offsetDelta);
      entryPos += 4;
    }
  } else if (co64Box) {
    const entryCount = view.getUint32(co64Box.payloadOffset + 4);
    let entryPos = co64Box.payloadOffset + 8;
    for (let i = 0; i < entryCount; i++) {
      const currentOffset = Number(view.getBigUint64(entryPos));
      view.setBigUint64(entryPos, BigInt(currentOffset + offsetDelta));
      entryPos += 8;
    }
  }
}

/**
 * แก้ไข Track ID ใน tkhd box เพื่อไม่ให้ Track 1 (Video) และ Track 2 (Audio) ชนกัน
 */
function setTrackId(buffer, trakBox, newTrackId) {
  const view = new DataView(buffer);
  const reader = new MP4BoxReader(buffer);
  const subBoxes = reader.getBoxes(trakBox.payloadOffset, trakBox.offset + trakBox.size);
  const tkhdBox = reader.findBoxRecursive(subBoxes, "tkhd");

  if (tkhdBox) {
    const version = view.getUint8(tkhdBox.payloadOffset);
    const trackIdOffset = version === 1 ? tkhdBox.payloadOffset + 20 : tkhdBox.payloadOffset + 12;
    view.setUint32(trackIdOffset, newTrackId);
  }
}

/**
 * รวม Video MP4 Buffer และ Audio MP4 Buffer เข้าเป็นไฟล์เดียวกัน (Zero Re-encoding)
 * @param {ArrayBuffer} videoBuffer - ไบนารีของวิดีโอภาพ
 * @param {ArrayBuffer} audioBuffer - ไบนารีของแทร็กเสียง
 * @returns {Promise<Blob>} - ไฟล์ MP4 ตัวเต็มที่มีทั้งภาพและเสียง
 */
async function remuxVideoAndAudio(videoBuffer, audioBuffer) {
  if (!videoBuffer || !videoBuffer.byteLength) {
    throw new Error("Invalid Video buffer");
  }
  if (!audioBuffer || !audioBuffer.byteLength) {
    // หากไม่มีไฟล์เสียง ส่งวิดีโอเดิมกลับ
    return new Blob([videoBuffer], { type: "video/mp4" });
  }

  const vReader = new MP4BoxReader(videoBuffer);
  const aReader = new MP4BoxReader(audioBuffer);

  const vBoxes = vReader.getBoxes();
  const aBoxes = aReader.getBoxes();

  const vFtyp = vBoxes.find((b) => b.type === "ftyp");
  const vMoov = vBoxes.find((b) => b.type === "moov");
  const vMdat = vBoxes.find((b) => b.type === "mdat");

  const aMoov = aBoxes.find((b) => b.type === "moov");
  const aMdat = aBoxes.find((b) => b.type === "mdat");

  if (!vMoov || !vMdat || !aMoov || !aMdat) {
    console.warn("[MP4 Remuxer] Required MP4 boxes not found, returning original video");
    return new Blob([videoBuffer], { type: "video/mp4" });
  }

  // 1. สกัด Video Track Box จาก Video Moov
  const vSubBoxes = vReader.getBoxes(vMoov.payloadOffset, vMoov.offset + vMoov.size);
  const vTraks = vReader.findAllBoxesRecursive(vSubBoxes, "trak");

  // 2. สกัด Audio Track Box จาก Audio Moov
  const aSubBoxes = aReader.getBoxes(aMoov.payloadOffset, aMoov.offset + aMoov.size);
  const aTraks = aReader.findAllBoxesRecursive(aSubBoxes, "trak");

  if (!vTraks.length || !aTraks.length) {
    return new Blob([videoBuffer], { type: "video/mp4" });
  }

  // โคลน Audio Track และเปลี่ยน Track ID เป็น 2
  const primaryAudioTrak = aTraks[0];
  const audioTrakSlice = audioBuffer.slice(primaryAudioTrak.offset, primaryAudioTrak.offset + primaryAudioTrak.size);
  setTrackId(audioTrakSlice, { offset: 0, size: audioTrakSlice.byteLength, payloadOffset: primaryAudioTrak.headerSize }, 2);

  // คำนวณส่วนต่าง Offset เพื่อเลื่อนตำแหน่ง Chunk ของ Audio ให้ไปอยู่หลัง Video mdat
  const videoMdatPayloadSize = vMdat.payloadSize;
  shiftTrackOffsets(audioTrakSlice, { offset: 0, size: audioTrakSlice.byteLength, payloadOffset: primaryAudioTrak.headerSize }, videoMdatPayloadSize);

  // 3. สร้าง Moov Box ใหม่ที่รวมทั้ง Video Trak และ Audio Trak
  const newMoovChildren = [];
  for (const box of vSubBoxes) {
    newMoovChildren.push(videoBuffer.slice(box.offset, box.offset + box.size));
  }
  newMoovChildren.push(audioTrakSlice);

  let newMoovPayloadSize = 0;
  newMoovChildren.forEach((c) => (newMoovPayloadSize += c.byteLength));

  const newMoovHeader = new ArrayBuffer(8);
  const newMoovHeaderView = new DataView(newMoovHeader);
  newMoovHeaderView.setUint32(0, newMoovPayloadSize + 8);
  newMoovHeaderView.setUint8(4, 0x6d); // 'm'
  newMoovHeaderView.setUint8(5, 0x6f); // 'o'
  newMoovHeaderView.setUint8(6, 0x6f); // 'o'
  newMoovHeaderView.setUint8(7, 0x76); // 'v'

  // 4. สร้าง Mdat Box รวมก้อน Payload ของภาพและเสียง
  const newMdatHeader = new ArrayBuffer(8);
  const newMdatHeaderView = new DataView(newMdatHeader);
  const totalMdatPayloadSize = vMdat.payloadSize + aMdat.payloadSize;
  newMdatHeaderView.setUint32(0, totalMdatPayloadSize + 8);
  newMdatHeaderView.setUint8(4, 0x6d); // 'm'
  newMdatHeaderView.setUint8(5, 0x64); // 'd'
  newMdatHeaderView.setUint8(6, 0x61); // 'a'
  newMdatHeaderView.setUint8(7, 0x74); // 't'

  const videoMdatPayload = videoBuffer.slice(vMdat.payloadOffset, vMdat.offset + vMdat.size);
  const audioMdatPayload = audioBuffer.slice(aMdat.payloadOffset, aMdat.offset + aMdat.size);

  // 5. รวมก้อน Binary ทั้งหมด
  const ftypPart = vFtyp ? videoBuffer.slice(vFtyp.offset, vFtyp.offset + vFtyp.size) : new ArrayBuffer(0);

  const parts = [
    ftypPart,
    newMoovHeader,
    ...newMoovChildren,
    newMdatHeader,
    videoMdatPayload,
    audioMdatPayload
  ];

  return new Blob(parts, { type: "video/mp4" });
}

if (typeof window !== "undefined") {
  window.remuxVideoAndAudio = remuxVideoAndAudio;
}
