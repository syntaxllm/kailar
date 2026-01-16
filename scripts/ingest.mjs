import fs from 'fs';
import path from 'path';
import { parseVTT } from '../lib/parser.js';
import { chunkEntries } from '../lib/indexer.js';

const mockDir = path.join(process.cwd(), 'public', 'mock_data');
const dataDir = path.join(process.cwd(), 'data');

await fs.promises.mkdir(dataDir, { recursive: true });

const files = (await fs.promises.readdir(mockDir)).filter(f => f.endsWith('.vtt'));
const meetings = [];
for (const f of files) {
  const content = await fs.promises.readFile(path.join(mockDir, f), 'utf8');
  const entries = parseVTT(content, f);
  const meetingId = f.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  meetings.push({ meetingId, source: f, importedAt: new Date().toISOString(), entries });
}

// write transcripts
await fs.promises.writeFile(path.join(dataDir, 'transcripts.json'), JSON.stringify(meetings, null, 2), 'utf8');

// chunk and write
const allChunks = [];
for (const m of meetings) {
  const chunks = chunkEntries(m.entries);
  chunks.forEach((c, idx) => { c.meetingId = m.meetingId; c.chunkId = `${m.meetingId}#${String(idx+1).padStart(4,'0')}`; });
  allChunks.push(...chunks);
}
await fs.promises.writeFile(path.join(dataDir, 'chunks.json'), JSON.stringify({ chunks: allChunks }, null, 2), 'utf8');

console.log('Ingested', meetings.length, 'meetings, chunks:', allChunks.length);
