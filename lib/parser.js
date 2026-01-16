export function parseVTT(content, filename = 'unknown.vtt') {
  // very small wrapper that mirrors services/parser behavior
  const lines = content.split(/\r?\n/);
  const timestampRE = /(\d{1,2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}\.\d{3})/;
  const entries = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const m = line.match(timestampRE);
    if (m) {
      const start = m[1]; const end = m[2]; i++;
      const textLines = [];
      while (i < lines.length && !lines[i].match(timestampRE)) {
        if (lines[i].trim() === '') { i++; break; }
        textLines.push(lines[i]); i++;
      }
      let raw = textLines.join(' ').trim();

      let speaker = 'Unknown';
      let text = raw;

      // Type 1: <v Speaker Name>Text</v> or <v Speaker Name>Text
      const vTagMatch = raw.match(/<v\s+([^>]+)>(.*)/i);
      if (vTagMatch) {
        speaker = vTagMatch[1].trim();
        text = vTagMatch[2].replace(/<\/v>/gi, '').trim();
      } else {
        // Type 2: Speaker: Text
        const colonMatch = raw.match(/^([^:]+):\s*(.+)$/);
        if (colonMatch) {
          speaker = colonMatch[1].trim();
          text = colonMatch[2].trim();
        }
      }

      entries.push({ start, end, speaker, text });
      continue;
    }
    i++;
  }
  return entries;
}
