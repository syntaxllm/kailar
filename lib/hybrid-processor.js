/**
 * Hybrid Processor v3 - Bot Always Joins
 * 
 * The Bot ALWAYS joins the meeting and:
 * 1. If user has Graph access → Bot enables Teams transcription → Fetch from Graph (FREE)
 * 2. If no Graph access → Bot records audio → STT → Transcript (PAID fallback)
 * 
 * This ensures:
 * - Cost optimization (use free Graph when possible)
 * - Reliability (bot recording when Graph fails)
 */

import { checkTranscriptAccess, fetchTeamsTranscript, AccessStatus } from './ms-graph.js';
import { requestBotJoin, getBotTranscript, isBotServiceAvailable, BotStatus } from './bot-service.js';
import { ingestTranscript, TranscriptSource } from './ingestion-pipeline.js';
import { recordGraphAccess } from './consent-manager.js';

/**
 * Processing Mode
 */
export const ProcessingMode = {
    GRAPH_API: 'graph_api',       // Bot enabled transcription, fetching from Graph (FREE)
    BOT_RECORDING: 'bot_recording' // Bot is recording audio for STT (PAID)
};

/**
 * Processing Status
 */
export const ProcessingStatus = {
    SUCCESS: 'success',
    BOT_JOINED: 'bot_joined',
    BOT_RECORDING: 'bot_recording',
    WAITING_TRANSCRIPT: 'waiting_transcript',
    FAILED: 'failed',
    NO_BOT_SERVICE: 'no_bot_service'
};

/**
 * Process a meeting - Bot Always Joins approach.
 * 
 * @param {object} context
 * @param {string} context.meetingId - Meeting identifier
 * @param {string} context.joinUrl - Teams meeting join URL
 * @param {string} context.accessToken - User's Graph API token
 * @param {boolean} context.isOrganizer - Is user the organizer?
 */
export async function processMeeting(context) {
    const { meetingId, joinUrl, accessToken, isOrganizer = false, options = {} } = context;

    console.log(`\n🔄 Processing Meeting: ${meetingId}`);
    console.log(`   Is Organizer: ${isOrganizer}`);

    // Check bot availability
    if (!isBotServiceAvailable()) {
        return {
            status: ProcessingStatus.NO_BOT_SERVICE,
            message: 'Bot service not configured',
            error: 'BOT_NOT_CONFIGURED'
        };
    }

    // STEP 1: Determine mode - can we use Graph API?
    let canUseGraph = false;

    if (accessToken) {
        try {
            const accessCheck = await checkTranscriptAccess(accessToken, joinUrl || meetingId);
            canUseGraph = accessCheck.hasAccess === true;
            console.log(`   Graph API accessible: ${canUseGraph}`);
        } catch (err) {
            console.log(`   Graph API check failed: ${err.message}`);
        }
    }

    // STEP 2: Request bot to join with appropriate mode
    const mode = canUseGraph ? ProcessingMode.GRAPH_API : ProcessingMode.BOT_RECORDING;
    console.log(`   Mode: ${mode}`);

    try {
        const botSession = await requestBotJoin(joinUrl, {
            meetingId,
            mode,
            enableTeamsTranscription: canUseGraph,  // Tell bot to enable Teams transcription
            recordAudio: !canUseGraph,               // Record only if Graph unavailable
            ...options
        });

        if (botSession.status === BotStatus.ERROR) {
            return {
                status: ProcessingStatus.FAILED,
                error: botSession.error
            };
        }

        // Record that we have Graph access for this meeting (for future reference)
        if (canUseGraph) {
            await recordGraphAccess(meetingId);
        }

        return {
            status: ProcessingStatus.BOT_JOINED,
            mode,
            sessionId: botSession.sessionId,
            message: canUseGraph
                ? 'Bot joined. Will enable Teams transcription and fetch from Graph (FREE).'
                : 'Bot joined. Will record audio for STT processing.',
            canUseGraph
        };
    } catch (err) {
        console.error('Bot join failed:', err);
        return {
            status: ProcessingStatus.FAILED,
            error: err.message
        };
    }
}

/**
 * Fetch transcript after meeting ends.
 * Called by bot webhook when meeting ends.
 * 
 * @param {string} sessionId - Bot session ID
 * @param {string} meetingId - Meeting ID
 * @param {string} mode - Processing mode (graph_api or bot_recording)
 * @param {string} accessToken - User's Graph token (for Graph mode)
 */
export async function fetchTranscriptPostMeeting(sessionId, meetingId, mode, accessToken = null, joinUrl = null) {
    console.log(`\n📥 Fetching transcript for: ${meetingId}`);
    console.log(`   Mode: ${mode}`);

    // MODE 1: Fetch from Graph API (FREE path)
    if (mode === ProcessingMode.GRAPH_API && accessToken) {
        try {
            console.log(`   → Fetching from Graph API...`);

            const vttContent = await fetchTeamsTranscript(accessToken, joinUrl || meetingId);

            if (vttContent && vttContent.length > 0) {
                const meeting = await ingestTranscript({
                    meetingId,
                    source: TranscriptSource.GRAPH_API,
                    content: vttContent,
                    metadata: {
                        method: 'graph_api',
                        sessionId,
                        fetchedAt: new Date().toISOString()
                    }
                });

                console.log(`   ✅ Graph transcript ingested`);
                return {
                    success: true,
                    method: 'graph_api',
                    meeting: { meetingId: meeting.meetingId, entries: meeting.entries?.length }
                };
            }
        } catch (err) {
            console.log(`   ⚠️ Graph fetch failed: ${err.message}`);
            // Fall through to bot recording
        }
    }

    // MODE 2: Get transcript from Bot STT (PAID path)
    console.log(`   → Getting transcript from Bot STT...`);

    try {
        const botResult = await getBotTranscript(sessionId);

        if (botResult.transcript) {
            const meeting = await ingestTranscript({
                meetingId,
                source: TranscriptSource.BOT_STT,
                content: botResult.transcript,
                metadata: {
                    method: 'bot_stt',
                    sessionId,
                    fetchedAt: new Date().toISOString()
                }
            });

            console.log(`   ✅ Bot STT transcript ingested`);
            return {
                success: true,
                method: 'bot_stt',
                meeting: { meetingId: meeting.meetingId, entries: meeting.entries?.length }
            };
        }
    } catch (err) {
        console.error(`   ❌ Bot STT failed: ${err.message}`);
    }

    return {
        success: false,
        error: 'Could not fetch transcript from any source'
    };
}

/**
 * Handle manual transcript upload (always works)
 */
export async function handleManualUpload(meetingId, content, filename) {
    return await ingestTranscript({
        meetingId,
        source: TranscriptSource.MANUAL_UPLOAD,
        content,
        metadata: { filename, method: 'manual_upload', uploadedAt: new Date().toISOString() }
    });
}
