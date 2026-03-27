// crispr_worker.js — Client-side sgRNA counting from FASTQ files
// Runs in a Web Worker to avoid blocking the UI thread

let guideMap = null;  // Map<sequence → {id, gene}>

self.onmessage = async function(e) {
  const { type, data } = e.data;

  if (type === 'load_library') {
    try {
      guideMap = new Map();
      for (const g of data.guides) {
        guideMap.set(g.seq.toUpperCase(), { id: g.id, gene: g.gene });
      }
      self.postMessage({ type: 'library_loaded', count: guideMap.size });
    } catch(err) {
      self.postMessage({ type: 'error', message: 'Library load failed: ' + err.message });
    }
    return;
  }

  if (type === 'count_files') {
    if (!guideMap) {
      self.postMessage({ type: 'error', message: 'Library not loaded. Load library first.' });
      return;
    }
    const { files, offset, guideLen } = data;
    const results = [];

    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      self.postMessage({ type: 'file_start', name: file.name, fileIdx: fi, total: files.length });
      try {
        const result = await countFile(file, offset, guideLen, (pct) => {
          self.postMessage({ type: 'file_progress', name: file.name, fileIdx: fi, total: files.length, pct });
        });
        results.push(result);
        self.postMessage({ type: 'file_done', name: file.name, fileIdx: fi, total: files.length, result });
      } catch(err) {
        const errResult = { name: file.name, error: err.message, readsTotal: 0, readsMapped: 0, mappingPct: 0, counts: {} };
        results.push(errResult);
        self.postMessage({ type: 'file_done', name: file.name, fileIdx: fi, total: files.length, result: errResult });
      }
    }

    self.postMessage({ type: 'all_done', results });
  }
};

async function countFile(file, offset, guideLen, onProgress) {
  const counts = new Map();  // guide_id → count
  let readsTotal = 0, readsMapped = 0;

  // Build stream; decompress gzip if needed
  let stream = file.stream();
  if (file.name.endsWith('.gz') || file.name.endsWith('.bgz')) {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let partial = '';
  let lineNum = 0;
  let bytesProcessed = 0;
  const reportEvery = 5_000_000;  // report progress every 5MB of decoded text
  let nextReport = reportEvery;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytesProcessed += value.byteLength;
    const chunk = partial + decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    partial = lines.pop();  // last incomplete line

    for (const rawLine of lines) {
      // FASTQ: line 0 = @header, line 1 = sequence, line 2 = +, line 3 = quality
      if (lineNum % 4 === 1) {
        const seq = rawLine.charCodeAt(0) > 47 ? rawLine.trimEnd().toUpperCase() : '';
        if (seq.length >= offset + guideLen) {
          readsTotal++;
          const guide = seq.slice(offset, offset + guideLen);
          const hit = guideMap.get(guide);
          if (hit) {
            readsMapped++;
            const prev = counts.get(hit.id);
            counts.set(hit.id, prev !== undefined ? prev + 1 : 1);
          }
        }
      }
      lineNum++;
    }

    if (bytesProcessed >= nextReport) {
      onProgress && onProgress(null);  // indeterminate (compressed size unknown)
      nextReport += reportEvery;
      // Yield to allow postMessage to flush
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Handle final partial line
  if (partial.trim() && lineNum % 4 === 1) {
    const seq = partial.trimEnd().toUpperCase();
    if (seq.length >= offset + guideLen) {
      readsTotal++;
      const guide = seq.slice(offset, offset + guideLen);
      const hit = guideMap.get(guide);
      if (hit) {
        readsMapped++;
        counts.set(hit.id, (counts.get(hit.id) || 0) + 1);
      }
    }
  }

  const mappingPct = readsTotal > 0 ? Math.round((readsMapped / readsTotal) * 1000) / 10 : 0;
  return {
    name: file.name,
    counts: Object.fromEntries(counts),
    readsTotal,
    readsMapped,
    mappingPct,
  };
}
