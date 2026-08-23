// ============================================================================
// SniffLens - HLS Streaming Video Stitcher Engine (v3.0.0)
// High-Throughput Big-O Optimized Concurrency Pool & Zero-Copy Blob Muxer
// ============================================================================

/**
 * Single-Pass M3U8 Lexical Parser (O(N) Complexity)
 * Parses Master Playlists and Media Playlists to extract chunk URLs in exact chronological order.
 */
async function parseM3U8Manifest(manifestUrl, abortSignal = null) {
  const response = await fetch(manifestUrl, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(`Failed to fetch M3U8 manifest: HTTP ${response.status}`);
  }

  const text = await response.text();
  const lines = text.split(/\r?\n/);
  const baseUrl = manifestUrl;

  let isMasterPlaylist = false;
  let highestBandwidth = -1;
  let bestMediaPlaylistUrl = null;
  const chunkUrls = [];

  // Single-Pass O(N) Line Scanner
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for Master Playlist Stream Variant
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      isMasterPlaylist = true;
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;

      // The next non-comment line is the sub-playlist URI
      let nextLineIndex = i + 1;
      while (nextLineIndex < lines.length && (!lines[nextLineIndex].trim() || lines[nextLineIndex].trim().startsWith("#"))) {
        nextLineIndex++;
      }

      if (nextLineIndex < lines.length) {
        const streamUri = lines[nextLineIndex].trim();
        if (bandwidth >= highestBandwidth) {
          highestBandwidth = bandwidth;
          bestMediaPlaylistUrl = new URL(streamUri, baseUrl).href;
        }
      }
    }

    // Check for Media Segment in Media Playlist
    if (!isMasterPlaylist && !line.startsWith("#")) {
      // Valid chunk segment URL
      try {
        const fullChunkUrl = new URL(line, baseUrl).href;
        chunkUrls.push(fullChunkUrl);
      } catch (err) {
        console.warn("[HLS Stitcher] Invalid chunk URI:", line);
      }
    }
  }

  // If Master Playlist, recurse once to fetch the highest bitrate Media Playlist (O(1) recursion depth)
  if (isMasterPlaylist && bestMediaPlaylistUrl) {
    return await parseM3U8Manifest(bestMediaPlaylistUrl, abortSignal);
  }

  if (!chunkUrls.length) {
    throw new Error("No playable video segments found in M3U8 manifest.");
  }

  return {
    playlistUrl: manifestUrl,
    totalChunks: chunkUrls.length,
    chunkUrls
  };
}

/**
 * Concurrency Worker Pool (O(N/K) Parallel Throughput)
 * Downloads chunks using K concurrent streams with O(1) Pre-allocated Slot Ingestion.
 */
async function downloadChunksWithPool(chunkUrls, concurrency = 6, onProgress = null, abortSignal = null) {
  const total = chunkUrls.length;
  // Pre-allocate contiguous array slots for O(1) direct placement (eliminates O(N log N) sorting)
  const chunksBufferArray = new Array(total);
  let nextIndex = 0;
  let completedCount = 0;
  let totalBytesReceived = 0;

  async function worker() {
    while (nextIndex < total) {
      if (abortSignal?.aborted) {
        throw new Error("Stitching aborted by user.");
      }

      const currentIndex = nextIndex++;
      const url = chunkUrls[currentIndex];

      try {
        const res = await fetch(url, { signal: abortSignal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();

        // O(1) Direct Slot Ingestion
        chunksBufferArray[currentIndex] = buffer;
        completedCount++;
        totalBytesReceived += buffer.byteLength;

        if (onProgress) {
          onProgress({
            completed: completedCount,
            total,
            percent: Math.round((completedCount / total) * 100),
            bytesReceived: totalBytesReceived
          });
        }
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        console.warn(`[HLS Stitcher] Retry chunk ${currentIndex + 1}/${total}:`, err.message);
        
        // Lightweight retry once (O(1))
        try {
          const retryRes = await fetch(url, { signal: abortSignal });
          if (!retryRes.ok) throw new Error(`HTTP ${retryRes.status}`);
          const retryBuffer = await retryRes.arrayBuffer();
          chunksBufferArray[currentIndex] = retryBuffer;
          completedCount++;
          totalBytesReceived += retryBuffer.byteLength;
          if (onProgress) {
            onProgress({
              completed: completedCount,
              total,
              percent: Math.round((completedCount / total) * 100),
              bytesReceived: totalBytesReceived
            });
          }
        } catch (retryErr) {
          throw new Error(`Failed to download video chunk ${currentIndex + 1}: ${retryErr.message}`);
        }
      }
    }
  }

  // Launch K workers in parallel
  const workers = [];
  const activeWorkers = Math.min(concurrency, total);
  for (let i = 0; i < activeWorkers; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return { chunksBufferArray, totalBytesReceived };
}

/**
 * Main Stitch & Download Controller
 * Integrates M3U8 parsing, concurrent downloading, zero-copy blob construction, and instant memory reclamation.
 */
async function stitchAndDownloadHlsVideo({
  manifestUrl,
  targetFilename = "video.mp4",
  folder = "captured",
  concurrency = 6,
  onProgress = null,
  abortSignal = null
}) {
  try {
    // 1. Single-Pass Parse Playlist
    const manifest = await parseM3U8Manifest(manifestUrl, abortSignal);

    // 2. Concurrently Fetch Chunks
    const { chunksBufferArray, totalBytesReceived } = await downloadChunksWithPool(
      manifest.chunkUrls,
      concurrency,
      onProgress,
      abortSignal
    );

    // 3. Zero-Copy Binary Blob Construction
    // Passing the array of ArrayBuffers directly to Blob allows the V8 engine to link chunks with zero copying
    const videoBlob = new Blob(chunksBufferArray, { type: "video/mp2t" });
    const objectUrl = URL.createObjectURL(videoBlob);

    // 4. O(1) Memory Dereferencing (Release chunk buffers for GC immediately)
    chunksBufferArray.length = 0;

    // 5. Trigger Browser Download via chrome.downloads
    const subfolder = folder ? folder.replace(/[\\/]+$/, "") + "/" : "";
    const cleanName = targetFilename.endsWith(".mp4") || targetFilename.endsWith(".ts")
      ? targetFilename
      : targetFilename + ".mp4";
    const fullPath = subfolder + cleanName;

    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: objectUrl,
          filename: fullPath,
          saveAs: false
        },
        (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(chrome.runtime.lastError?.message || "Download failed to initiate."));
          } else {
            // Revoke Object URL after short delay (O(1) memory cleanup)
            setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
            resolve({
              downloadId,
              fullPath,
              totalBytes: totalBytesReceived,
              chunksCount: manifest.totalChunks
            });
          }
        }
      );
    });
  } catch (err) {
    throw err;
  }
}

// Export functions for ES Module / Browser global environment
if (typeof window !== "undefined") {
  window.parseM3U8Manifest = parseM3U8Manifest;
  window.downloadChunksWithPool = downloadChunksWithPool;
  window.stitchAndDownloadHlsVideo = stitchAndDownloadHlsVideo;
}
