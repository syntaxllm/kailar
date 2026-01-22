import path from 'path';
import * as storage from './storage-prod.js';
import { parseVTT } from './parser.js';
import { chunkEntries } from './indexer.js';
import { fetchTeamsTranscript, fetchTeamsRecording } from './ms-graph.js';

/**
 * Handle real Microsoft Teams Ingestion
 */
export async function ingestTeamsMeeting(accessToken, teamsMeetingId) {
  // 1. Fetch real VTT content from MS Graph
  const vttContent = await fetchTeamsTranscript(accessToken, teamsMeetingId);

  // Validate content before parsing
  if (!vttContent || vttContent.trim().length === 0) {
    throw new Error('EMPTY_TRANSCRIPT_CONTENT');
  }

  // 2. Parse the VTT content
  const entries = parseVTT(vttContent, `teams_${teamsMeetingId}.vtt`);
  
  // Validate parsing results
  if (!entries || entries.length === 0) {
    console.error(`Parser returned 0 entries for meeting ${teamsMeetingId}`);
    console.error(`VTT content preview (first 500 chars):`, vttContent.substring(0, 500));
    throw new Error('PARSER_RETURNED_ZERO_ENTRIES');
  }
  
  console.log(`Parsed ${entries.length} transcript entries for meeting ${teamsMeetingId}`);

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

  // 5. Generate RAG Chunks
  const chunks = chunkEntries(entries);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    c.meetingId = meetingId;
    c.chunkId = `${meetingId}#${String(i + 1).padStart(4, '0')}`;
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

export async function updateMeeting(meetingId, updateData) {
  return await storage.updateMeeting(meetingId, updateData);
}

export async function deleteMeeting(meetingId) {
  return await storage.deleteMeeting(meetingId);
}

function calculateDuration(entries) {
  if (!entries || entries.length === 0) return 0;
  const end = entries[entries.length - 1].end || entries[entries.length - 1].start;
  const parts = (end || '00:00:00').split(':');
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}


