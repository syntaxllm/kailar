/**
 * Backend Adapter (Hybrid Architecture)
 * 
 * Provides backward-compatible API while integrating with the new hybrid system.
 */

import * as storage from './storage-prod.js';
import { parseVTT } from './parser.js';
import { chunkEntries } from './indexer.js';
import { fetchTeamsTranscript, fetchTeamsRecording, checkTranscriptAccess } from './ms-graph.js';
import { processMeeting, handleManualUpload } from './hybrid-processor.js';
import { checkConsent, grantConsent } from './consent-manager.js';

/**
 * Handle real Microsoft Teams Ingestion (Legacy - Direct Graph API)
 * Still works for organizers with direct access.
 */
export async function ingestTeamsMeeting(accessToken, teamsMeetingId) {
  // 1. Fetch real VTT content from MS Graph
  const vttContent = await fetchTeamsTranscript(accessToken, teamsMeetingId);

  // 2. Parse the VTT content
  const entries = parseVTT(vttContent, `teams_${teamsMeetingId}.vtt`);

  // 3. Fetch Recording metadata if available
  let recordingUrl = null;
  try {
    const recording = await fetchTeamsRecording(accessToken, teamsMeetingId);
    if (recording) recordingUrl = recording.contentUrl;
  } catch (e) { console.error("No recording found or permission denied", e); }

  // 4. Normalize into meeting object
  const meetingId = generateMeetingId(teamsMeetingId);
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

  // 5. Save to MongoDB
  await storage.saveTranscripts(meetingObj);

  // 6. Generate RAG Chunks
  const chunks = chunkEntries(entries);
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].meetingId = meetingId;
    chunks[i].chunkId = `${meetingId}#${String(i + 1).padStart(4, '0')}`;
  }

  // 7. Save Chunks to MongoDB Atlas
  await storage.saveChunks(chunks);

  return meetingObj;
}

/**
 * NEW: Hybrid Meeting Ingestion
 * Uses the hybrid processor to handle both Option 1 and Option 2.
 */
export async function ingestMeetingHybrid(accessToken, meetingIdOrUrl, userEmail) {
  const meetingId = generateMeetingId(meetingIdOrUrl);

  return await processMeeting({
    meetingId,
    joinUrl: meetingIdOrUrl.startsWith('http') ? meetingIdOrUrl : null,
    accessToken,
    userEmail
  });
}

/**
 * NEW: Check if transcript is accessible for a meeting
 */
export async function checkMeetingAccess(accessToken, meetingIdOrUrl) {
  return await checkTranscriptAccess(accessToken, meetingIdOrUrl);
}

/**
 * NEW: Grant consent for a meeting
 */
export async function grantMeetingConsent(meetingId, organizerEmail, method = 'manual') {
  return await grantConsent(meetingId, organizerEmail, method);
}

// === Existing Functions (Unchanged) ===

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

// === Utility Functions ===

function generateMeetingId(input) {
  // If it's a URL, extract a hash
  if (input.startsWith('http')) {
    const hash = input.split('/').pop().substring(0, 12);
    return `teams-${hash}`;
  }
  // If it's already an ID, format it
  if (input.length > 20) {
    return `teams-${input.substring(0, 12)}`;
  }
  return input;
}

function calculateDuration(entries) {
  if (!entries || entries.length === 0) return 0;
  const end = entries[entries.length - 1].end || entries[entries.length - 1].start;
  const parts = (end || '00:00:00').split(':');
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}
