import fs from 'fs';
import path from 'path';
import * as storage from './storage-prod.js';
import { parseVTT } from './parser.js';
import { chunkEntries } from './indexer.js';
import { fetchTeamsTranscript } from './ms-graph.js';

const mockDir = path.join(process.cwd(), 'public', 'mock_data');

/**
 * Handle real Microsoft Teams Ingestion
 */
export async function ingestTeamsMeeting(accessToken, teamsMeetingId) {
  // 1. Fetch real VTT content from MS Graph
  const vttContent = await fetchTeamsTranscript(accessToken, teamsMeetingId);

  // 2. Parse the VTT content
  const entries = parseVTT(vttContent, `teams_${teamsMeetingId}.vtt`);

  // 3.5 Fetch Recording metadata if available
  let recordingUrl = null;
  try {
    const recording = await fetchTeamsRecording(accessToken, teamsMeetingId);
    if (recording) recordingUrl = recording.contentUrl;
  } catch (e) { console.error("No recording found or permission denied", e); }

  // 3. Normalize into meeting object
  const meetingId = `teams-${teamsMeetingId.substring(0, 8)}`;
  const meetingObj = {
    meetingId,
    source: 'Microsoft Teams API',
    externalId: teamsMeetingId,
    recordingUrl: recordingUrl,
    importedAt: new Date().toISOString(),
    durationSeconds: calculateDuration(entries),
    entries: entries.map((e, idx) => ({
      id: `${meetingId}:${String(idx + 1).padStart(4, '0')}`,
      sequence: idx + 1,
      ...e
    }))
  };

  // 4. Save to MongoDB
  await storage.saveTranscripts(meetingObj);

  // 5. Generate RAG Chunks with Embeddings
  const chunks = chunkEntries(entries);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    c.meetingId = meetingId;
    c.chunkId = `${meetingId}#${String(i + 1).padStart(4, '0')}`;

    // This is the part that makes it "Vector Search"
    try {
      const { generateEmbedding } = await import('./vector-service.js');
      c.embedding = await generateEmbedding(c.text);
    } catch (e) {
      console.warn("Embedding failed for chunk", i, e.message);
    }
  }

  // 6. Save Chunks to MongoDB Atlas
  await storage.saveChunks(chunks);

  return meetingObj;
}

export async function loadTranscripts() {
  return await storage.loadTranscripts();
}

export async function getMeeting(meetingId) {
  return await storage.getMeeting(meetingId);
}

export async function loadChunksForMeeting(meetingId) {
  return await storage.loadChunks(meetingId);
}

function calculateDuration(entries) {
  if (!entries || entries.length === 0) return 0;
  const end = entries[entries.length - 1].end || entries[entries.length - 1].start;
  const parts = (end || '00:00:00').split(':');
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

export async function importMock({ force = false } = {}) {
  const summary = { imported: 0, skipped: 0, errors: [] };
  const files = (await fs.promises.readdir(mockDir)).filter(f => f.endsWith('.vtt'));

  for (const f of files) {
    try {
      const meetingId = f.replace('.vtt', '');
      const existing = await storage.getMeeting(meetingId);
      if (existing && !force) {
        summary.skipped++;
        continue;
      }

      const content = await fs.promises.readFile(path.join(mockDir, f), 'utf8');
      const entries = parseVTT(content, f);

      const meetingObj = {
        meetingId,
        source: f,
        importedAt: new Date().toISOString(),
        durationSeconds: calculateDuration(entries),
        entries: entries.map((e, idx) => ({
          id: `${meetingId}:${String(idx + 1).padStart(4, '0')}`,
          sequence: idx + 1,
          ...e
        }))
      };

      await storage.saveTranscripts(meetingObj);

      const chunks = chunkEntries(entries);
      chunks.forEach((c, i) => {
        c.meetingId = meetingId;
        c.chunkId = `${meetingId}#${String(i + 1).padStart(4, '0')}`;
      });
      await storage.saveChunks(chunks);

      summary.imported++;
    } catch (err) {
      summary.errors.push({ file: f, error: String(err) });
    }
  }
  return summary;
}
