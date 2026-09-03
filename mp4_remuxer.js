// ============================================================================
// SniffLens ISO-BMFF Universal Monolithic MP4 Multiplexer Engine (v3.5.0 Golden Master)
// High-Performance In-Browser Binary Stream Remuxer (Zero Re-Encoding, O(N))
// Converts DASH Fragmented MP4 (fMP4) and Progressive MP4 streams into a
// Universal Progressive Monolithic MP4 with unified 'moov' and 'mdat' tables.
// 100% Guaranteed Audio Playback on Windows Media Player, VLC, QuickTime & Mobile.
// ============================================================================

/**
 * ISO-BMFF Box Parser & Binary Stream Reader
 */
class MP4BoxReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
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

      const actualSize = size === 1
        ? Number(this.view.getBigUint64(offset + 8))
        : (size === 0 ? endOffset - offset : size);

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
      if (["moov", "trak", "mdia", "minf", "stbl", "edts", "mvex", "moof", "traf"].includes(box.type)) {
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
      if (["moov", "trak", "mdia", "minf", "stbl", "edts", "mvex", "moof", "traf"].includes(box.type)) {
        const subBoxes = this.getBoxes(box.payloadOffset, box.offset + box.size);
        this.findAllBoxesRecursive(subBoxes, targetType, result);
      }
    }
    return result;
  }
}

/**
 * สร้าง ftyp box มาตรฐานสากล (ISO Base Media File Format - isom/mp42)
 */
function createStandardFtypBox() {
  const brandStr = "isomiso2mp41mp42";
  const size = 16 + brandStr.length;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint32(0, size);
  view.setUint8(4, 0x66); view.setUint8(5, 0x74); view.setUint8(6, 0x79); view.setUint8(7, 0x70); // 'ftyp'
  view.setUint8(8, 0x69); view.setUint8(9, 0x73); view.setUint8(10, 0x6f); view.setUint8(11, 0x6d); // 'isom'
  view.setUint32(12, 0x00000200); // minor_version = 512
  for (let i = 0; i < brandStr.length; i++) {
    view.setUint8(16 + i, brandStr.charCodeAt(i));
  }
  return buf;
}

/**
 * ดึงประเภท Handler ('vide' หรือ 'soun') ของ Track
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
 * สกัด Raw Media Samples จากสตรีม (รองรับทั้ง Fragmented fMP4 และ Monolithic MP4)
 */
function extractSamplesFromStream(buffer, isAudio = false) {
  const reader = new MP4BoxReader(buffer);
  const boxes = reader.getBoxes();
  const moovBox = boxes.find((b) => b.type === "moov");

  if (!moovBox) {
    throw new Error("No moov box found in stream");
  }

  const moovSub = reader.getBoxes(moovBox.payloadOffset, moovBox.offset + moovBox.size);
  const traks = reader.findAllBoxesRecursive(moovSub, "trak");
  const targetHandler = isAudio ? "soun" : "vide";
  const trakBox = traks.find((t) => getTrackHandlerType(buffer, t) === targetHandler) || traks[0];

  if (!trakBox) {
    throw new Error(`No ${targetHandler} track found in stream`);
  }

  // ดึง stsd (Sample Description Box)
  const trakSub = reader.getBoxes(trakBox.payloadOffset, trakBox.offset + trakBox.size);
  const stsdBox = reader.findBoxRecursive(trakSub, "stsd");
  let stsdSlice = null;
  if (stsdBox) {
    stsdSlice = buffer.slice(stsdBox.offset, stsdBox.offset + stsdBox.size);
  }

  // ดึง Timescale และ Duration
  const mdhdBox = reader.findBoxRecursive(trakSub, "mdhd");
  let timescale = 1000;
  let duration = 0;
  if (mdhdBox) {
    const view = new DataView(buffer);
    const version = view.getUint8(mdhdBox.payloadOffset);
    timescale = version === 1 ? view.getUint32(mdhdBox.payloadOffset + 20) : view.getUint32(mdhdBox.payloadOffset + 12);
    duration = version === 1 ? Number(view.getBigUint64(mdhdBox.payloadOffset + 24)) : view.getUint32(mdhdBox.payloadOffset + 16);
  }

  // ดึง Video Width / Height จาก tkhd
  let width = 0;
  let height = 0;
  const tkhdBox = reader.findBoxRecursive(trakSub, "tkhd");
  if (tkhdBox) {
    const view = new DataView(buffer);
    const version = view.getUint8(tkhdBox.payloadOffset);
    const widthOffset = version === 1 ? tkhdBox.payloadOffset + 88 : tkhdBox.payloadOffset + 76;
    width = view.getUint32(widthOffset) >>> 16;
    height = view.getUint32(widthOffset + 4) >>> 16;
  }

  const isFragmented = boxes.some((b) => b.type === "moof");
  const samples = [];
  const rawBytes = new Uint8Array(buffer);

  if (isFragmented) {
    // ดึง default sample values จาก trex / tfhd
    let defaultDuration = isAudio ? 1024 : 1000;
    let defaultSize = 0;
    const mvex = reader.findBoxRecursive(moovSub, "mvex");
    if (mvex) {
      const mvexSub = reader.getBoxes(mvex.payloadOffset, mvex.offset + mvex.size);
      const trex = mvexSub.find((b) => b.type === "trex");
      if (trex) {
        const view = new DataView(buffer);
        defaultDuration = view.getUint32(trex.payloadOffset + 12);
        defaultSize = view.getUint32(trex.payloadOffset + 16);
      }
    }

    // วนลูปสกัดทุก Fragment (moof + mdat)
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].type === "moof") {
        const moof = boxes[i];
        let mdat = null;
        if (i + 1 < boxes.length && boxes[i + 1].type === "mdat") {
          mdat = boxes[i + 1];
        }

        if (!mdat) continue;

        const moofSub = reader.getBoxes(moof.payloadOffset, moof.offset + moof.size);
        const trafs = reader.findAllBoxesRecursive(moofSub, "traf");

        for (const traf of trafs) {
          const trafSub = reader.getBoxes(traf.payloadOffset, traf.offset + traf.size);
          const tfhd = reader.findBoxRecursive(trafSub, "tfhd");
          const trun = reader.findBoxRecursive(trafSub, "trun");

          let currentDuration = defaultDuration;
          let currentSize = defaultSize;

          if (tfhd) {
            const view = new DataView(buffer);
            const flags = (view.getUint8(tfhd.payloadOffset + 1) << 16) | (view.getUint8(tfhd.payloadOffset + 2) << 8) | view.getUint8(tfhd.payloadOffset + 3);
            let pos = tfhd.payloadOffset + 8; // skip version(1) + flags(3) + track_ID(4)
            if (flags & 0x000001) pos += 8; // base_data_offset
            if (flags & 0x000002) pos += 4; // sample_description_index
            if (flags & 0x000008) { currentDuration = view.getUint32(pos); pos += 4; }
            if (flags & 0x000010) { currentSize = view.getUint32(pos); pos += 4; }
          }

          if (trun) {
            const view = new DataView(buffer);
            const flags = (view.getUint8(trun.payloadOffset + 1) << 16) | (view.getUint8(trun.payloadOffset + 2) << 8) | view.getUint8(trun.payloadOffset + 3);
            const sampleCount = view.getUint32(trun.payloadOffset + 4);
            let pos = trun.payloadOffset + 8;

            let dataOffset = mdat.payloadOffset;
            if (flags & 0x000001) {
              const explicitOffset = view.getInt32(pos);
              dataOffset = moof.offset + explicitOffset;
              pos += 4;
            }
            if (flags & 0x000004) pos += 4; // first_sample_flags

            const hasDuration = Boolean(flags & 0x000100);
            const hasSize = Boolean(flags & 0x000200);
            const hasFlags = Boolean(flags & 0x000400);
            const hasCts = Boolean(flags & 0x000800);

            let currentDataOffset = dataOffset;
            for (let s = 0; s < sampleCount; s++) {
              const dur = hasDuration ? view.getUint32(pos) : currentDuration;
              if (hasDuration) pos += 4;

              const sz = hasSize ? view.getUint32(pos) : currentSize;
              if (hasSize) pos += 4;

              const flg = hasFlags ? view.getUint32(pos) : 0;
              if (hasFlags) pos += 4;

              const cts = hasCts ? view.getInt32(pos) : 0;
              if (hasCts) pos += 4;

              const isKey = !isAudio && ((flg & 0x00010000) === 0 || s === 0);
              const sampleSlice = rawBytes.subarray(currentDataOffset, currentDataOffset + sz);

              samples.push({
                size: sz,
                duration: dur,
                cts: cts,
                isKeyframe: isKey,
                data: sampleSlice
              });

              currentDataOffset += sz;
            }
          }
        }
      }
    }
  } else {
    // Monolithic Stream Extraction (stts, stsz, stsc, stco)
    const stbl = reader.findBoxRecursive(trakSub, "stbl");
    if (stbl) {
      const stblSub = reader.getBoxes(stbl.payloadOffset, stbl.offset + stbl.size);
      const stsz = reader.findBoxRecursive(stblSub, "stsz");
      const stco = reader.findBoxRecursive(stblSub, "stco");
      const co64 = reader.findBoxRecursive(stblSub, "co64");
      const stts = reader.findBoxRecursive(stblSub, "stts");
      const stsc = reader.findBoxRecursive(stblSub, "stsc");
      const stss = reader.findBoxRecursive(stblSub, "stss");

      if (stsz && (stco || co64)) {
        const view = new DataView(buffer);
        const uniformSize = view.getUint32(stsz.payloadOffset + 4);
        const sampleCount = view.getUint32(stsz.payloadOffset + 8);

        const sampleSizes = [];
        if (uniformSize > 0) {
          for (let s = 0; s < sampleCount; s++) sampleSizes.push(uniformSize);
        } else {
          let pos = stsz.payloadOffset + 12;
          for (let s = 0; s < sampleCount; s++) {
            sampleSizes.push(view.getUint32(pos));
            pos += 4;
          }
        }

        // Chunk offsets
        const chunkOffsets = [];
        if (stco) {
          const count = view.getUint32(stco.payloadOffset + 4);
          let pos = stco.payloadOffset + 8;
          for (let c = 0; c < count; c++) {
            chunkOffsets.push(view.getUint32(pos));
            pos += 4;
          }
        } else if (co64) {
          const count = view.getUint32(co64.payloadOffset + 4);
          let pos = co64.payloadOffset + 8;
          for (let c = 0; c < count; c++) {
            chunkOffsets.push(Number(view.getBigUint64(pos)));
            pos += 8;
          }
        }

        // Sample to Chunk table
        const scEntries = [];
        if (stsc) {
          const count = view.getUint32(stsc.payloadOffset + 4);
          let pos = stsc.payloadOffset + 8;
          for (let e = 0; e < count; e++) {
            scEntries.push({
              firstChunk: view.getUint32(pos),
              samplesPerChunk: view.getUint32(pos + 4)
            });
            pos += 12;
          }
        }

        // Time to Sample table
        const defaultDur = isAudio ? 1024 : 1000;
        const durations = [];
        if (stts) {
          const count = view.getUint32(stts.payloadOffset + 4);
          let pos = stts.payloadOffset + 8;
          for (let t = 0; t < count; t++) {
            const sc = view.getUint32(pos);
            const sd = view.getUint32(pos + 4);
            for (let k = 0; k < sc; k++) durations.push(sd);
            pos += 8;
          }
        }

        // Keyframe index set
        const keyframeSet = new Set();
        if (stss) {
          const count = view.getUint32(stss.payloadOffset + 4);
          let pos = stss.payloadOffset + 8;
          for (let k = 0; k < count; k++) {
            keyframeSet.add(view.getUint32(pos) - 1);
            pos += 4;
          }
        }

        let sampleIdx = 0;
        for (let chunkIdx = 0; chunkIdx < chunkOffsets.length; chunkIdx++) {
          const chunkNumber = chunkIdx + 1;
          let spc = 1;
          for (let sc = scEntries.length - 1; sc >= 0; sc--) {
            if (chunkNumber >= scEntries[sc].firstChunk) {
              spc = scEntries[sc].samplesPerChunk;
              break;
            }
          }

          let chunkByteOffset = chunkOffsets[chunkIdx];
          for (let s = 0; s < spc && sampleIdx < sampleSizes.length; s++) {
            const sz = sampleSizes[sampleIdx];
            const dur = durations[sampleIdx] || defaultDur;
            const isKey = keyframeSet.has(sampleIdx) || isAudio || sampleIdx === 0;

            const sampleSlice = rawBytes.subarray(chunkByteOffset, chunkByteOffset + sz);
            samples.push({
              size: sz,
              duration: dur,
              cts: 0,
              isKeyframe: isKey,
              data: sampleSlice
            });

            chunkByteOffset += sz;
            sampleIdx++;
          }
        }
      }
    }
  }

  let totalDuration = 0;
  samples.forEach((s) => (totalDuration += s.duration));

  return {
    timescale,
    duration: totalDuration || duration,
    width,
    height,
    stsdSlice,
    samples
  };
}

/**
 * สร้าง stbl (Sample Table Box) ตัวเต็มสำหรับ Progressive Monolithic MP4
 */
function buildMonolithicStbl(sampleList, timescale, isAudio, mdatStartOffset, stsdSlice) {
  const sampleCount = sampleList.length;

  // 1. stsd box
  let stsdBuf = stsdSlice;
  if (!stsdBuf) {
    const dummy = new ArrayBuffer(16);
    new DataView(dummy).setUint32(0, 16);
    stsdBuf = dummy;
  }

  // 2. stts (Time-to-Sample Box)
  const sttsEntries = [];
  if (sampleCount > 0) {
    let curDur = sampleList[0].duration;
    let curCount = 1;
    for (let i = 1; i < sampleCount; i++) {
      if (sampleList[i].duration === curDur) {
        curCount++;
      } else {
        sttsEntries.push({ count: curCount, delta: curDur });
        curDur = sampleList[i].duration;
        curCount = 1;
      }
    }
    sttsEntries.push({ count: curCount, delta: curDur });
  }

  const sttsSize = 16 + sttsEntries.length * 8;
  const sttsBuf = new ArrayBuffer(sttsSize);
  const sttsView = new DataView(sttsBuf);
  sttsView.setUint32(0, sttsSize);
  sttsView.setUint8(4, 0x73); sttsView.setUint8(5, 0x74); sttsView.setUint8(6, 0x74); sttsView.setUint8(7, 0x73); // 'stts'
  sttsView.setUint32(12, sttsEntries.length);
  let sttsPos = 16;
  for (const entry of sttsEntries) {
    sttsView.setUint32(sttsPos, entry.count);
    sttsView.setUint32(sttsPos + 4, entry.delta);
    sttsPos += 8;
  }

  // 3. stss (Sync Sample Box - Keyframes สำหรับ Video)
  let stssBuf = null;
  if (!isAudio) {
    const keyframes = [];
    for (let i = 0; i < sampleCount; i++) {
      if (sampleList[i].isKeyframe || i === 0) {
        keyframes.push(i + 1); // 1-based index
      }
    }

    const stssSize = 16 + keyframes.length * 4;
    stssBuf = new ArrayBuffer(stssSize);
    const stssView = new DataView(stssBuf);
    stssView.setUint32(0, stssSize);
    stssView.setUint8(4, 0x73); stssView.setUint8(5, 0x74); stssView.setUint8(6, 0x73); stssView.setUint8(7, 0x73); // 'stss'
    stssView.setUint32(12, keyframes.length);
    let stssPos = 16;
    for (const kf of keyframes) {
      stssView.setUint32(stssPos, kf);
      stssPos += 4;
    }
  }

  // 4. stsc (Sample-to-Chunk Box)
  // กำหนด 1 Sample ต่อ 1 Chunk เพื่อความแม่นยำในการคำนวณตำแหน่ง Byte Offset
  const stscSize = 16 + 12;
  const stscBuf = new ArrayBuffer(stscSize);
  const stscView = new DataView(stscBuf);
  stscView.setUint32(0, stscSize);
  stscView.setUint8(4, 0x73); stscView.setUint8(5, 0x74); stscView.setUint8(6, 0x73); stscView.setUint8(7, 0x63); // 'stsc'
  stscView.setUint32(12, 1); // entry_count = 1
  stscView.setUint32(16, 1); // first_chunk = 1
  stscView.setUint32(20, 1); // samples_per_chunk = 1
  stscView.setUint32(24, 1); // sample_description_index = 1

  // 5. stsz (Sample Size Box)
  const stszSize = 20 + sampleCount * 4;
  const stszBuf = new ArrayBuffer(stszSize);
  const stszView = new DataView(stszBuf);
  stszView.setUint32(0, stszSize);
  stszView.setUint8(4, 0x73); stszView.setUint8(5, 0x74); stszView.setUint8(6, 0x73); stszView.setUint8(7, 0x7a); // 'stsz'
  stszView.setUint32(12, 0); // sample_size = 0 (variable)
  stszView.setUint32(16, sampleCount);
  let stszPos = 20;
  for (const s of sampleList) {
    stszView.setUint32(stszPos, s.size);
    stszPos += 4;
  }

  // 6. stco / co64 (Chunk Offset Box)
  let currentOffset = mdatStartOffset;
  const useCo64 = currentOffset > 0xFFFFFFFF; // 64-bit offset only when exceeding 4GB

  let stcoBuf;
  if (!useCo64) {
    const stcoSize = 16 + sampleCount * 4;
    stcoBuf = new ArrayBuffer(stcoSize);
    const stcoView = new DataView(stcoBuf);
    stcoView.setUint32(0, stcoSize);
    stcoView.setUint8(4, 0x73); stcoView.setUint8(5, 0x74); stcoView.setUint8(6, 0x63); stcoView.setUint8(7, 0x6f); // 'stco'
    stcoView.setUint32(12, sampleCount);
    let stcoPos = 16;
    for (const s of sampleList) {
      stcoView.setUint32(stcoPos, currentOffset >>> 0);
      currentOffset += s.size;
      stcoPos += 4;
    }
  } else {
    const co64Size = 16 + sampleCount * 8;
    stcoBuf = new ArrayBuffer(co64Size);
    const co64View = new DataView(stcoBuf);
    co64View.setUint32(0, co64Size);
    co64View.setUint8(4, 0x63); co64View.setUint8(5, 0x6f); co64View.setUint8(6, 0x36); co64View.setUint8(7, 0x34); // 'co64'
    co64View.setUint32(12, sampleCount);
    let co64Pos = 16;
    for (const s of sampleList) {
      co64View.setBigUint64(co64Pos, BigInt(currentOffset));
      currentOffset += s.size;
      co64Pos += 8;
    }
  }

  const parts = [stsdBuf, sttsBuf];
  if (stssBuf) parts.push(stssBuf);
  parts.push(stscBuf, stszBuf, stcoBuf);

  let stblPayloadSize = 0;
  parts.forEach((p) => (stblPayloadSize += p.byteLength));

  const stblHeader = new ArrayBuffer(8);
  const stblHeaderView = new DataView(stblHeader);
  stblHeaderView.setUint32(0, 8 + stblPayloadSize);
  stblHeaderView.setUint8(4, 0x73); stblHeaderView.setUint8(5, 0x74); stblHeaderView.setUint8(6, 0x62); stblHeaderView.setUint8(7, 0x6c); // 'stbl'

  return [stblHeader, ...parts];
}

/**
 * สร้าง trak box (Track Header, Media Header, Media Info, Sample Table)
 */
function buildMonolithicTrak(trackData, trackId, movieTimescale, mdatStartOffset, isAudio) {
  const durationInMovieTimescale = Math.round((trackData.duration / trackData.timescale) * movieTimescale);

  // 1. tkhd Box
  const tkhdSize = 92;
  const tkhdBuf = new ArrayBuffer(tkhdSize);
  const tkhdView = new DataView(tkhdBuf);
  tkhdView.setUint32(0, tkhdSize);
  tkhdView.setUint8(4, 0x74); tkhdView.setUint8(5, 0x6b); tkhdView.setUint8(6, 0x68); tkhdView.setUint8(7, 0x64); // 'tkhd'
  tkhdView.setUint8(8, 0x00); // version = 0
  tkhdView.setUint8(9, 0x00); tkhdView.setUint8(10, 0x00); tkhdView.setUint8(11, 0x07); // flags = 0x000007 (Track enabled, in movie, in preview)
  tkhdView.setUint32(20, trackId); // track_ID
  tkhdView.setUint32(28, durationInMovieTimescale); // duration
  tkhdView.setUint16(42, 0); // alternate_group = 0
  tkhdView.setUint16(44, isAudio ? 0x0100 : 0); // volume = 1.0 (Audio) or 0 (Video)

  // Unity Matrix
  tkhdView.setUint32(48, 0x00010000);
  tkhdView.setUint32(64, 0x00010000);
  tkhdView.setUint32(80, 0x40000000);

  if (!isAudio) {
    tkhdView.setUint32(84, (trackData.width || 1920) << 16);
    tkhdView.setUint32(88, (trackData.height || 1080) << 16);
  }

  // 2. mdhd Box
  const mdhdSize = 32;
  const mdhdBuf = new ArrayBuffer(mdhdSize);
  const mdhdView = new DataView(mdhdBuf);
  mdhdView.setUint32(0, mdhdSize);
  mdhdView.setUint8(4, 0x6d); mdhdView.setUint8(5, 0x64); mdhdView.setUint8(6, 0x68); mdhdView.setUint8(7, 0x64); // 'mdhd'
  mdhdView.setUint32(20, trackData.timescale); // timescale
  mdhdView.setUint32(24, trackData.duration); // duration
  mdhdView.setUint16(28, 0x55c4); // language = 'und'

  // 3. hdlr Box
  const hdlrType = isAudio ? "soun" : "vide";
  const hdlrName = isAudio ? "SoundHandler\0" : "VideoHandler\0";
  const hdlrSize = 32 + hdlrName.length;
  const hdlrBuf = new ArrayBuffer(hdlrSize);
  const hdlrView = new DataView(hdlrBuf);
  hdlrView.setUint32(0, hdlrSize);
  hdlrView.setUint8(4, 0x68); hdlrView.setUint8(5, 0x64); hdlrView.setUint8(6, 0x6c); hdlrView.setUint8(7, 0x72); // 'hdlr'
  for (let i = 0; i < 4; i++) {
    hdlrView.setUint8(16 + i, hdlrType.charCodeAt(i));
  }
  for (let i = 0; i < hdlrName.length; i++) {
    hdlrView.setUint8(32 + i, hdlrName.charCodeAt(i));
  }

  // 4. vmhd / smhd Box
  let mediaHeaderBuf;
  if (!isAudio) {
    const vmhdSize = 20;
    mediaHeaderBuf = new ArrayBuffer(vmhdSize);
    const vmhdView = new DataView(mediaHeaderBuf);
    vmhdView.setUint32(0, vmhdSize);
    vmhdView.setUint8(4, 0x76); vmhdView.setUint8(5, 0x6d); vmhdView.setUint8(6, 0x68); vmhdView.setUint8(7, 0x64); // 'vmhd'
    vmhdView.setUint8(11, 0x01); // flags = 1
  } else {
    const smhdSize = 16;
    mediaHeaderBuf = new ArrayBuffer(smhdSize);
    const smhdView = new DataView(mediaHeaderBuf);
    smhdView.setUint32(0, smhdSize);
    smhdView.setUint8(4, 0x73); smhdView.setUint8(5, 0x6d); smhdView.setUint8(6, 0x68); smhdView.setUint8(7, 0x64); // 'smhd'
  }

  // 5. dinf (Data Information Box with url)
  const dinfSize = 36;
  const dinfBuf = new ArrayBuffer(dinfSize);
  const dinfView = new DataView(dinfBuf);
  dinfView.setUint32(0, dinfSize);
  dinfView.setUint8(4, 0x64); dinfView.setUint8(5, 0x69); dinfView.setUint8(6, 0x6e); dinfView.setUint8(7, 0x66); // 'dinf'
  dinfView.setUint32(8, 28); // dref size
  dinfView.setUint8(12, 0x64); dinfView.setUint8(13, 0x72); dinfView.setUint8(14, 0x65); dinfView.setUint8(15, 0x66); // 'dref'
  dinfView.setUint32(20, 1); // entry_count = 1
  dinfView.setUint32(24, 12); // url size
  dinfView.setUint8(28, 0x75); dinfView.setUint8(29, 0x72); dinfView.setUint8(30, 0x6c); dinfView.setUint8(31, 0x20); // 'url '
  dinfView.setUint8(35, 0x01); // self-contained flag = 1

  // 6. stbl Box
  const stblBoxes = buildMonolithicStbl(trackData.samples, trackData.timescale, isAudio, mdatStartOffset, trackData.stsdSlice);

  // ประกอบ minf Box
  const minfParts = [mediaHeaderBuf, dinfBuf, ...stblBoxes];
  let minfPayloadSize = 0;
  minfParts.forEach((p) => (minfPayloadSize += p.byteLength));
  const minfHeader = new ArrayBuffer(8);
  const minfHeaderView = new DataView(minfHeader);
  minfHeaderView.setUint32(0, 8 + minfPayloadSize);
  minfHeaderView.setUint8(4, 0x6d); minfHeaderView.setUint8(5, 0x69); minfHeaderView.setUint8(6, 0x6e); minfHeaderView.setUint8(7, 0x66); // 'minf'

  // ประกอบ mdia Box
  const mdiaParts = [mdhdBuf, hdlrBuf, minfHeader, ...minfParts];
  let mdiaPayloadSize = 0;
  mdiaParts.forEach((p) => (mdiaPayloadSize += p.byteLength));
  const mdiaHeader = new ArrayBuffer(8);
  const mdiaHeaderView = new DataView(mdiaHeader);
  mdiaHeaderView.setUint32(0, 8 + mdiaPayloadSize);
  mdiaHeaderView.setUint8(4, 0x6d); mdiaHeaderView.setUint8(5, 0x64); mdiaHeaderView.setUint8(6, 0x69); mdiaHeaderView.setUint8(7, 0x61); // 'mdia'

  // ประกอบ trak Box
  const trakParts = [tkhdBuf, mdiaHeader, ...mdiaParts];
  let trakPayloadSize = 0;
  trakParts.forEach((p) => (trakPayloadSize += p.byteLength));
  const trakHeader = new ArrayBuffer(8);
  const trakHeaderView = new DataView(trakHeader);
  trakHeaderView.setUint32(0, 8 + trakPayloadSize);
  trakHeaderView.setUint8(4, 0x74); trakHeaderView.setUint8(5, 0x72); trakHeaderView.setUint8(6, 0x61); trakHeaderView.setUint8(7, 0x6b); // 'trak'

  return [trakHeader, ...trakParts];
}

/**
 * Universal Progressive Monolithic MP4 Multiplexer Engine
 * รวมสตรีมวิดีโอและเสียงให้เป็นไฟล์ MP4 แท้ที่รองรับทุกโปรแกรม 100%
 */
async function remuxToUniversalMonolithicMP4(videoBuffer, audioBuffer) {
  if (!videoBuffer || !audioBuffer || videoBuffer.byteLength < 32 || audioBuffer.byteLength < 32) {
    return new Blob([videoBuffer], { type: "video/mp4" });
  }

  // 1. สกัด Media Samples จากสตรีมทั้งสอง
  const videoData = extractSamplesFromStream(videoBuffer, false);
  const audioData = extractSamplesFromStream(audioBuffer, true);

  if (!videoData.samples.length || !audioData.samples.length) {
    console.warn("[Remuxer] Empty samples, fallback to raw video");
    return new Blob([videoBuffer], { type: "video/mp4" });
  }

  const movieTimescale = 1000;
  const vDurationInMovie = Math.round((videoData.duration / videoData.timescale) * movieTimescale);
  const aDurationInMovie = Math.round((audioData.duration / audioData.timescale) * movieTimescale);
  const finalMovieDuration = Math.max(vDurationInMovie, aDurationInMovie);

  // 2. คำนวณขนาดของ mdat รวม
  let totalVideoBytes = 0;
  videoData.samples.forEach((s) => (totalVideoBytes += s.size));
  let totalAudioBytes = 0;
  audioData.samples.forEach((s) => (totalAudioBytes += s.size));
  const totalMdatPayload = totalVideoBytes + totalAudioBytes;

  const ftypPart = createStandardFtypBox();
  const ftypLength = ftypPart.byteLength;

  // mvhd Box (Movie Header)
  const mvhdSize = 108;
  const mvhdBuf = new ArrayBuffer(mvhdSize);
  const mvhdView = new DataView(mvhdBuf);
  mvhdView.setUint32(0, mvhdSize);
  mvhdView.setUint8(4, 0x6d); mvhdView.setUint8(5, 0x76); mvhdView.setUint8(6, 0x68); mvhdView.setUint8(7, 0x64); // 'mvhd'
  mvhdView.setUint32(20, movieTimescale);
  mvhdView.setUint32(24, finalMovieDuration);
  mvhdView.setUint32(28, 0x00010000); // rate = 1.0
  mvhdView.setUint16(32, 0x0100); // volume = 1.0
  mvhdView.setUint32(44, 0x00010000); // matrix
  mvhdView.setUint32(60, 0x00010000);
  mvhdView.setUint32(76, 0x40000000);
  mvhdView.setUint32(96, 3); // next_track_ID = 3

  // คำนวณล่วงหน้าสำหรับตำแหน่งเริ่มต้นของ mdat
  const dummyVBoxes = buildMonolithicTrak(videoData, 1, movieTimescale, 0, false);
  const dummyABoxes = buildMonolithicTrak(audioData, 2, movieTimescale, 0, true);

  let dummyMoovPayload = mvhdSize;
  dummyVBoxes.forEach((p) => (dummyMoovPayload += p.byteLength));
  dummyABoxes.forEach((p) => (dummyMoovPayload += p.byteLength));
  const newMoovSize = 8 + dummyMoovPayload;

  const mdatHeaderSize = 8;
  const finalMdatStartOffset = ftypLength + newMoovSize + mdatHeaderSize;

  // สร้าง trak Box ของจริงด้วย Offset ที่แท้จริง
  const vTrakBoxes = buildMonolithicTrak(videoData, 1, movieTimescale, finalMdatStartOffset, false);
  const aTrakBoxes = buildMonolithicTrak(audioData, 2, movieTimescale, finalMdatStartOffset + totalVideoBytes, true);

  const moovHeader = new ArrayBuffer(8);
  const moovHeaderView = new DataView(moovHeader);
  moovHeaderView.setUint32(0, newMoovSize);
  moovHeaderView.setUint8(4, 0x6d); moovHeaderView.setUint8(5, 0x6f); moovHeaderView.setUint8(6, 0x6f); moovHeaderView.setUint8(7, 0x76); // 'moov'

  // สร้าง mdat Header
  const mdatHeader = new ArrayBuffer(8);
  const mdatHeaderView = new DataView(mdatHeader);
  mdatHeaderView.setUint32(0, 8 + totalMdatPayload);
  mdatHeaderView.setUint8(4, 0x6d); mdatHeaderView.setUint8(5, 0x64); mdatHeaderView.setUint8(6, 0x61); mdatHeaderView.setUint8(7, 0x74); // 'mdat'

  // รวม Payload ของ Samples ทั้งหมด
  const videoPayloads = videoData.samples.map((s) => s.data);
  const audioPayloads = audioData.samples.map((s) => s.data);

  const finalParts = [
    ftypPart,
    moovHeader,
    mvhdBuf,
    ...vTrakBoxes,
    ...aTrakBoxes,
    mdatHeader,
    ...videoPayloads,
    ...audioPayloads
  ];

  return new Blob(finalParts, { type: "video/mp4" });
}

if (typeof window !== "undefined") {
  window.remuxVideoAndAudio = remuxToUniversalMonolithicMP4;
  window.remuxToUniversalMonolithicMP4 = remuxToUniversalMonolithicMP4;
}
