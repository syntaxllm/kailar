/**
 * Hybrid Processor v2 - Bot-First Architecture
 * 
 * The Bot is the PRIMARY method for transcript ingestion.
 * Graph API is a BONUS when available (organizer access, free).
 * 
 * Flow:
 *   User requests transcript
 *        ↓
 *   Quick check: Do we have Graph API access? (fast, cheap)
 *   ├── YES → Fetch native transcript (bonus path)
 *   └── NO  → Bot records/has recorded → STT → Transcript (main path)
 */

import { checkTranscriptAccess, fetchTeamsTranscript, AccessStatus } from './ms-graph.js';
import { requestBotJoin, getBotTranscript, getBotSessionStatus, isBotServiceAvailable, BotStatus } from './bot-service.js';
import { ingestTranscript, TranscriptSource } from './ingestion-pipeline.js';

/**
 * Processing Status
 */
export const ProcessingStatus = {
    SUCCESS: 'success',
    IN_PROGRESS: 'in_progress',
    BOT_JOINING: 'bot_joining',
    BOT_RECORDING: 'bot_recording',
    FAILED: 'failed',
    NO_BOT_SERVICE: 'no_bot_service'
};

/**
 * Process a meeting - Bot-First approach.
 * 
 * @param {object} context
 * @param {string} context.meetingId - Unique meeting identifier
 * @param {string} context.joinUrl - Teams meeting join URL
 * @param {string} context.accessToken - User's Graph API token (optional)
 * @param {object} context.options - Additional options
 */
export async function processMeeting(context) {
    const { meetingId, joinUrl, accessToken, options = {} } = context;

    console.log(`\n🔄 Processing Meeting: ${meetingId}`);

    // STEP 1: Quick check - can we use Graph API? (Bonus path - free)
    if (accessToken && !options.forceBotMode) {
        console.log(`   → Checking Graph API access (bonus path)...`);

        try {
            const accessCheck = await checkTranscriptAccess(accessToken, joinUrl || meetingId);

            if (accessCheck.hasAccess) {
                console.log(`   ✅ Graph API accessible - using free native transcript`);

                const vttContent = await fetchTeamsTranscript(accessToken, joinUrl || meetingId);

                const meeting = await ingestTranscript({
                    meetingId,
                    source: TranscriptSource.GRAPH_API,
                    content: vttContent,
                    metadata: { method: 'graph_api', fetchedAt: new Date().toISOString() }
                });

                return {
                    status: ProcessingStatus.SUCCESS,
                    method: 'graph_api',
                    message: 'Transcript fetched via Microsoft Graph (free)',
                    meeting: { meetingId: meeting.meetingId, entries: meeting.entries?.length || 0 }
                };
            }
        } catch (err) {
            console.log(`   ⚠️ Graph API not available: ${err.message}`);
            // Continue to Bot path
        }
    }

    // STEP 2: Main path - Use Bot
    console.log(`   → Using Bot Service (main path)...`);

    if (!isBotServiceAvailable()) {
        console.log(`   ❌ Bot Service not configured`);
        return {
            status: ProcessingStatus.NO_BOT_SERVICE,
            method: 'none',
            message: 'Bot service is not configured. Please set BOT_SERVICE_URL in environment.',
            error: 'BOT_NOT_CONFIGURED'
        };
    }

    try {
        // Request bot to join and record
        const botSession = await requestBotJoin(joinUrl, {
            meetingId,
            ...options
        });

        if (botSession.status === BotStatus.ERROR) {
            return {
                status: ProcessingStatus.FAILED,
                method: 'bot',
                message: 'Bot failed to join the meeting',
                error: botSession.error
            };
        }

        return {
            status: ProcessingStatus.BOT_JOINING,
            method: 'bot',
            sessionId: botSession.sessionId,
            message: 'Bot is joining the meeting. Transcript will be available after the meeting ends.',
        };
    } catch (err) {
        console.error('Bot join failed:', err);
        return {
            status: ProcessingStatus.FAILED,
            method: 'bot',
            message: err.message,
            error: err.message
        };
    }
}

/**
 * Get processing status for a meeting/session
 */
export async function getProcessingStatus(sessionId) {
    if (!sessionId) {
        return { status: 'unknown', message: 'No session ID provided' };
    }

    try {
        const status = await getBotSessionStatus(sessionId);
        return status;
    } catch (err) {
        return { status: 'error', message: err.message };
    }
}

/**
 * Complete a bot session and ingest the transcript
 */
export async function completeBotSession(sessionId, meetingId) {
    console.log(`\n🤖 Completing bot session: ${sessionId}`);

    try {
        const result = await getBotTranscript(sessionId);

        if (!result.transcript) {
            return { success: false, error: 'No transcript from bot session' };
        }

        const meeting = await ingestTranscript({
            meetingId,
            source: TranscriptSource.BOT_STT,
            content: result.transcript,
            metadata: { sessionId, method: 'bot_stt', fetchedAt: new Date().toISOString() }
        });

        return { success: true, meeting };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Handle manual transcript upload (always available)
 */
export async function handleManualUpload(meetingId, content, filename) {
    console.log(`\n📤 Manual upload for meeting: ${meetingId}`);

    return await ingestTranscript({
        meetingId,
        source: TranscriptSource.MANUAL_UPLOAD,
        content,
        metadata: { filename, method: 'manual_upload', uploadedAt: new Date().toISOString() }
    });
}
