export function chunkEntries(entries, opts = { windowSec: 90, minChars: 350, overlapSec: 15 }) {
  // very small in-memory chunker for the web app
  const chunks = [];
  let seq = 0;
  let i = 0;
  const sorted = (entries || []).slice().map((e, idx) => ({ ...e, startSec: timeToSec(e.start) })).sort((a, b) => a.startSec - b.startSec);
  while (i < sorted.length) {
    const startSec = sorted[i].startSec || 0;
    let endSec = sorted[i].end ? timeToSec(sorted[i].end) : startSec + 5;
    let textAcc = '';
    let j = i;
    while (j < sorted.length) {
      const e = sorted[j];
      const speakerLabel = e.speaker ? `[${e.speaker}]: ` : '';
      const entryText = `${speakerLabel}${e.text}`;
      const potentialText = textAcc ? (textAcc + '\n' + entryText) : entryText;
      const potentialEnd = e.end ? timeToSec(e.end) : e.startSec;
      if ((potentialEnd - startSec) > opts.windowSec && potentialText.length >= opts.minChars) break;
      textAcc = potentialText; endSec = potentialEnd; j++;
    }
    seq++;
    const chunk = { chunkId: `web#${String(seq).padStart(4, '0')}`, sequence: seq, startSec, endSec, text: textAcc };
    chunks.push(chunk);
    // advance with overlap
    const threshold = endSec - opts.overlapSec; let k = j; while (k < sorted.length && (sorted[k].startSec || 0) < threshold) k++; if (k === i) k = j || i + 1; i = k;
  }
  return chunks;
}
function timeToSec(t) { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); }
