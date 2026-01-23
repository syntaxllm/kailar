/**
 * Ingestion Pipeline
 * 
 * Unified pipeline for meeting transcript ingestion.
 * Handles BOTH paths:
 *   - Option 1: Native Graph API transcript (organizer consent)
 *   - Option 2: Bot-recorded transcript (fallback)
 * 
 * Flow:
 * 1. Receive meeting context (ID, URL, source)
 * 2. Normalize transcript to common format
 * 3. Store in MongoDB
 * 4. Index for RAG
 * 5. Queue for AI processing (summaries, actions)
 */

import { saveTranscripts, saveChunks } from './storage-prod.js';
import { parseVTT } from './parser.js';
import { chunkEntries } from './indexer.js';

/**
 * Transcript Source Types
 */
export const TranscriptSource = {
    GRAPH_API: 'graph_api',           // Native Teams transcript via MS Graph
    BOT_STT: 'bot_stt',               // Bot-recorded, processed by STT
    MANUAL_UPLOAD: 'manual_upload',   // User uploaded VTT file
    POWER_AUTOMATE: 'power_automate'  // Sent via Power Automate webhook
};

/**
 * Ingest a transcript from any source.
 * This is the main entry point for the pipeline.
 * 
 * @param {object} input
 * @param {string} input.meetingId - Unique identifier for the meeting
 * @param {string} input.source - One of TranscriptSource values
 * @param {string} input.content - Raw transcript content (VTT string or JSON)
 * @param {object} input.metadata - Additional meeting metadata
 * @returns {Promise<object>} Ingested meeting object
 */
export async function ingestTranscript(input) {
    const {
        meetingId,
        source,
        content,
        metadata = {}
    } = input;

    console.log(`📥 Ingesting transcript for meeting: ${meetingId}`);
    console.log(`   Source: ${source}`);

    // Step 1: Parse the transcript based on format
    let entries = [];

    if (source === TranscriptSource.GRAPH_API ||
        source === TranscriptSource.MANUAL_UPLOAD) {
        // VTT format
        entries = parseVTT(content, `${meetingId}.vtt`);
    } else if (source === TranscriptSource.BOT_STT) {
        // Bot returns JSON format with timestamps
        entries = normalizeSTTTranscript(content);
    } else if (source === TranscriptSource.POWER_AUTOMATE) {
        // Could be VTT or JSON, detect and parse
        entries = detectAndParse(content, meetingId);
    }

    console.log(`   Parsed ${entries.length} transcript entries`);

    // Step 2: Build meeting object
    const meetingObj = {
        meetingId,
        source,
        importedAt: new Date().toISOString(),
        durationSeconds: calculateDuration(entries),
        metadata: {
            ...metadata,
            transcriptSource: source
        },
        entries: entries.map((e, idx) => ({
            id: `${meetingId}:${String(idx + 1).padStart(4, '0')}`,
            sequence: idx + 1,
            ...e
        }))
    };

    // Step 3: Save to MongoDB
    await saveTranscripts(meetingObj);
    console.log(`   ✅ Saved transcript to database`);

    // Step 4: Generate and save RAG chunks
    const chunks = chunkEntries(entries);
    for (let i = 0; i < chunks.length; i++) {
        chunks[i].meetingId = meetingId;
        chunks[i].chunkId = `${meetingId}#${String(i + 1).padStart(4, '0')}`;
    }
    await saveChunks(chunks);
    console.log(`   ✅ Indexed ${chunks.length} RAG chunks`);

    return meetingObj;
}

/**
 * Normalize STT transcript output to our standard format.
 * Different STT providers return different formats.
 * 
 * @param {string|object} content - STT output
 * @returns {Array} Normalized entries
 */
function normalizeSTTTranscript(content) {
    // Handle JSON string
    let data = typeof content === 'string' ? JSON.parse(content) : content;

    // 1. Check if it's our new "Standard Contract" format (array of entries)
    // { start_time, end_time, speaker_id, text }
    if (Array.isArray(data)) {
        return data.map(entry => ({
            start: formatTime(entry.start_time || entry.start || 0),
            end: formatTime(entry.end_time || entry.end || 0),
            text: (entry.text || entry.transcript || '').trim(),
            speaker: entry.speaker_id || entry.speaker || 'Unknown'
        }));
    }

    // 2. Handle original Whisper format
    if (data.segments) {
        return data.segments.map(seg => ({
            start: formatTime(seg.start),
            end: formatTime(seg.end),
            text: seg.text.trim(),
            speaker: seg.speaker || 'Unknown'
        }));
    }

    console.warn('Unknown STT format, returning empty entries');
    return [];
}

/**
 * Detect content format and parse accordingly
 */
function detectAndParse(content, meetingId) {
    // Check if it's VTT
    if (typeof content === 'string' && content.includes('WEBVTT')) {
        return parseVTT(content, `${meetingId}.vtt`);
    }

    // Try JSON
    try {
        return normalizeSTTTranscript(content);
    } catch {
        console.warn('Could not detect format, treating as plain text');
        return [{
            start: '00:00:00',
            end: '00:00:00',
            text: content,
            speaker: 'Unknown'
        }];
    }
}

/**
 * Calculate duration from entries
 */
function calculateDuration(entries) {
    if (!entries || entries.length === 0) return 0;
    const lastEntry = entries[entries.length - 1];
    const endTime = lastEntry.end || lastEntry.start;
    const parts = (endTime || '00:00:00').split(':');
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

/**
 * Format seconds to HH:MM:SS
 */
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
