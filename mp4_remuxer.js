// ============================================================================
// SniffLens ISO-BMFF Fast MP4 Video + Audio Remuxer Engine (v3.2.1)
// High-Performance In-Browser Binary Stream Remuxer (Zero Re-Encoding, O(N))
// Accurately merges 1 Video Track (vide) + 1 Audio Track (soun) into a standard MP4 container.
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
 * ดึงประเภท Handler ของ Track ('vide' หรือ 'soun')
 */
function getTrackHandlerType(buffer, trakBox) {
  const reader = new MP4BoxReader(buffer);
  const subBoxes = reader.getBoxes(trakBox.payloadOffset, trakBox.offset + trakBox.size);
  const hdlrBox = reader.findBoxRecursive(subBoxes, "hdlr");
  if (!hdlrBox) return null;
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < 4; i++) {
    str += String.fromCharCode(bytes[hdlrBox.payloadOffset + 8 + i]);
  }
  return str;
}

/**
 * ปรับ Chunk Offsets (stco / co64) ของ Track ให้ตรงกับตำแหน่ง byte จริงในไฟล์ใหม่
 */
function shiftTrackOffsets(buffer, trakBox, offsetDelta) {
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
 * ตั้งค่า Track ID และระดับเสียง (Volume) ใน tkhd box
 */
function setTrackIdAndVolume(buffer, trakBox, newTrackId, isAudio) {
  const view = new DataView(buffer);
  const reader = new MP4BoxReader(buffer);
  const subBoxes = reader.getBoxes(trakBox.payloadOffset, trakBox.offset + trakBox.size);
  const tkhdBox = reader.findBoxRecursive(subBoxes, "tkhd");

  if (tkhdBox) {
    const version = view.getUint8(tkhdBox.payloadOffset);
    const trackIdOffset = version === 1 ? tkhdBox.payloadOffset + 20 : tkhdBox.payloadOffset + 12;
    view.setUint32(trackIdOffset, newTrackId);

    const volumeOffset = version === 1 ? tkhdBox.payloadOffset + 44 : tkhdBox.payloadOffset + 36;
    view.setUint16(volumeOffset, isAudio ? 0x0100 : 0);
  }
}

/**
 * รวม Video MP4 Buffer และ Audio MP4 Buffer เข้าเป็นไฟล์เดียวกัน (Zero Re-encoding)
 * @param {ArrayBuffer} videoBuffer - ไบนารีของวิดีโอภาพ
 * @param {ArrayBuffer} audioBuffer - ไบนารีของแทร็กเสียง
 * @returns {Promise<Blob>} - ไฟล์ MP4 ตัวเต็มที่มีทั้งภาพและเสียงสมบูรณ์
 */
async function remuxVideoAndAudio(videoBuffer, audioBuffer) {
  if (!videoBuffer || !videoBuffer.byteLength) {
    throw new Error("Invalid Video buffer");
  }
  if (!audioBuffer || !audioBuffer.byteLength) {
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

  const vSubBoxes = vReader.getBoxes(vMoov.payloadOffset, vMoov.offset + vMoov.size);
  const vTraks = vReader.findAllBoxesRecursive(vSubBoxes, "trak");

  const aSubBoxes = aReader.getBoxes(aMoov.payloadOffset, aMoov.offset + aMoov.size);
  const aTraks = aReader.findAllBoxesRecursive(aSubBoxes, "trak");

  // ค้นหา Video Track และ Audio Track ที่แท้จริงจาก Handler Type ('vide' และ 'soun')
  const vTrakBox = vTraks.find((t) => getTrackHandlerType(videoBuffer, t) === "vide") || vTraks[0];
  const aTrakBox = aTraks.find((t) => getTrackHandlerType(audioBuffer, t) === "soun") || aTraks[0];

  if (!vTrakBox || !aTrakBox) {
    return new Blob([videoBuffer], { type: "video/mp4" });
  }

  // โคลน Track Slices เพื่อไม่ให้กระทบต้นฉบับ
  const vTrakSlice = videoBuffer.slice(vTrakBox.offset, vTrakBox.offset + vTrakBox.size);
  const aTrakSlice = audioBuffer.slice(aTrakBox.offset, aTrakBox.offset + aTrakBox.size);

  // ตั้งค่า Track ID 1 สำหรับ Video และ Track ID 2 สำหรับ Audio
  setTrackIdAndVolume(vTrakSlice, { offset: 0, size: vTrakSlice.byteLength, payloadOffset: vTrakBox.headerSize }, 1, false);
  setTrackIdAndVolume(aTrakSlice, { offset: 0, size: aTrakSlice.byteLength, payloadOffset: aTrakBox.headerSize }, 2, true);

  // สกัดกล่องอื่นๆ ภายใน moov (mvhd, udta) จากวิดีโอ
  const nonTrakBoxes = [];
  for (const b of vSubBoxes) {
    if (b.type !== "trak") {
      const slice = videoBuffer.slice(b.offset, b.offset + b.size);
      if (b.type === "mvhd") {
        const view = new DataView(slice);
        const version = view.getUint8(b.headerSize);
        const nextTrackOffset = version === 1 ? b.headerSize + 108 : b.headerSize + 96;
        if (nextTrackOffset + 4 <= slice.byteLength) {
          view.setUint32(nextTrackOffset, 3); // next_track_ID = 3
        }
      }
      nonTrakBoxes.push(slice);
    }
  }

  // คำนวณขนาดและตำแหน่ง byte offset ที่แท้จริงของไฟล์ใหม่
  const ftypPart = vFtyp ? videoBuffer.slice(vFtyp.offset, vFtyp.offset + vFtyp.size) : new ArrayBuffer(0);
  const ftypLength = ftypPart.byteLength;

  let moovPayloadSize = 0;
  nonTrakBoxes.forEach((b) => (moovPayloadSize += b.byteLength));
  moovPayloadSize += vTrakSlice.byteLength + aTrakSlice.byteLength;
  const newMoovSize = 8 + moovPayloadSize;

  const newMdatHeaderSize = 8;
  const newMdatPayloadOffset = ftypLength + newMoovSize + newMdatHeaderSize;

  // คำนวณส่วนต่าง Offset (Delta) เพื่อปรับ stco / co64 ทั้งแทร็กภาพและแทร็กเสียง
  const vOffsetDelta = newMdatPayloadOffset - vMdat.payloadOffset;
  const aOffsetDelta = (newMdatPayloadOffset + vMdat.payloadSize) - aMdat.payloadOffset;

  // ปรับ Chunk Offsets ใน stco / co64 ให้ตรงกับตำแหน่งจริงในไฟล์ใหม่
  shiftTrackOffsets(vTrakSlice, { offset: 0, size: vTrakSlice.byteLength, payloadOffset: vTrakBox.headerSize }, vOffsetDelta);
  shiftTrackOffsets(aTrakSlice, { offset: 0, size: aTrakSlice.byteLength, payloadOffset: aTrakBox.headerSize }, aOffsetDelta);

  // สร้าง moov header ใหม่
  const newMoovHeader = new ArrayBuffer(8);
  const newMoovHeaderView = new DataView(newMoovHeader);
  newMoovHeaderView.setUint32(0, newMoovSize);
  newMoovHeaderView.setUint8(4, 0x6d); // 'm'
  newMoovHeaderView.setUint8(5, 0x6f); // 'o'
  newMoovHeaderView.setUint8(6, 0x6f); // 'o'
  newMoovHeaderView.setUint8(7, 0x76); // 'v'

  // สร้าง mdat header ใหม่
  const totalMdatPayloadSize = vMdat.payloadSize + aMdat.payloadSize;
  const newMdatHeader = new ArrayBuffer(8);
  const newMdatHeaderView = new DataView(newMdatHeader);
  newMdatHeaderView.setUint32(0, 8 + totalMdatPayloadSize);
  newMdatHeaderView.setUint8(4, 0x6d); // 'm'
  newMdatHeaderView.setUint8(5, 0x64); // 'd'
  newMdatHeaderView.setUint8(6, 0x61); // 'a'
  newMdatHeaderView.setUint8(7, 0x74); // 't'

  const vMdatPayload = videoBuffer.slice(vMdat.payloadOffset, vMdat.offset + vMdat.size);
  const aMdatPayload = audioBuffer.slice(aMdat.payloadOffset, aMdat.offset + aMdat.size);

  const parts = [
    ftypPart,
    newMoovHeader,
    ...nonTrakBoxes,
    vTrakSlice,
    aTrakSlice,
    newMdatHeader,
    vMdatPayload,
    aMdatPayload
  ];

  return new Blob(parts, { type: "video/mp4" });
}

if (typeof window !== "undefined") {
  window.remuxVideoAndAudio = remuxVideoAndAudio;
}
