/**
 * Hybrid Meeting Processor
 * 
 * This is the ORCHESTRATION layer that implements the decision flow:
 * 
 *   Meeting Scheduled
 *        ↓
 *   Does organizer consent exist?
 *   ├── YES → Use native Teams transcript via Graph (Option 1)
 *   └── NO  → Bot records audio with disclosure (Option 2)
 *        ↓
 *   Unified Ingestion Pipeline
 *        ↓
 *   AI Processing → Deliver Insights
 * 
 * This module is the "brain" that coordinates all the hybrid pieces.
 */

import { checkConsent, shouldUseBotFallback, ConsentStatus } from './consent-manager.js';
import { checkTranscriptAccess, fetchTeamsTranscript, AccessStatus } from './ms-graph.js';
import { requestBotJoin, getBotTranscript, isBotServiceAvailable, BotStatus } from './bot-service.js';
import { ingestTranscript, TranscriptSource } from './ingestion-pipeline.js';

/**
 * Processing Status
 */
export const ProcessingStatus = {
    PENDING: 'pending',
    OPTION_1_ACTIVE: 'option_1_active',   // Using native transcript
    OPTION_2_ACTIVE: 'option_2_active',   // Using bot recording
    COMPLETED: 'completed',
    FAILED: 'failed',
    AWAITING_CONSENT: 'awaiting_consent'
};

/**
 * Process a meeting for transcript ingestion.
 * This is the main entry point called when we want to get insights for a meeting.
 * 
 * @param {object} context
 * @param {string} context.meetingId - Unique meeting identifier
 * @param {string} context.joinUrl - Teams meeting join URL
 * @param {string} context.accessToken - User's Graph API token
 * @param {string} context.userEmail - Current user's email
 * @param {object} context.options - Additional options
 * @returns {Promise<object>} Processing result
 */
export async function processMeeting(context) {
    const {
        meetingId,
        joinUrl,
        accessToken,
        userEmail,
        options = {}
    } = context;

    console.log(`\n🔄 Processing Meeting: ${meetingId}`);
    console.log(`   User: ${userEmail}`);

    // Step 1: Check consent status (our database)
    const consentResult = await checkConsent(meetingId);
    console.log(`   Consent Status: ${consentResult.status}`);

    // Step 2: If consent granted, try Option 1 (Graph API)
    if (consentResult.status === ConsentStatus.GRANTED) {
        console.log(`   → Attempting Option 1 (Native Transcript)`);

        const option1Result = await tryOption1(accessToken, meetingId, joinUrl);

        if (option1Result.success) {
            console.log(`   ✅ Option 1 succeeded`);
            return {
                status: ProcessingStatus.COMPLETED,
                method: 'option_1',
                meeting: option1Result.meeting
            };
        }

        console.log(`   ⚠️ Option 1 failed: ${option1Result.error}`);
        // Fall through to Option 2
    }

    // Step 3: Check if we should use Bot (Option 2)
    const fallbackCheck = await shouldUseBotFallback(meetingId);

    if (fallbackCheck.useBot) {
        console.log(`   → Option 2 needed (Reason: ${fallbackCheck.reason})`);

        // Check if Bot Service is available
        if (!isBotServiceAvailable()) {
            console.log(`   ❌ Bot Service not configured`);

            // Return with status indicating what's needed
            return {
                status: ProcessingStatus.AWAITING_CONSENT,
                method: 'none',
                message: 'Transcript access requires organizer consent. Bot service not available as fallback.',
                consentRequired: true
            };
        }

        // Request bot to join/record
        const option2Result = await tryOption2(meetingId, joinUrl, options);

        if (option2Result.success) {
            console.log(`   ✅ Option 2 initiated`);
            return {
                status: option2Result.status,
                method: 'option_2',
                sessionId: option2Result.sessionId
            };
        }

        console.log(`   ❌ Option 2 failed: ${option2Result.error}`);
    }

    // Step 4: Neither option available - request consent
    return {
        status: ProcessingStatus.AWAITING_CONSENT,
        method: 'none',
        message: 'Unable to access meeting transcript. Please request organizer consent or use manual upload.',
        consentRequired: true,
        actions: [
            { type: 'request_consent', label: 'Request Access from Organizer' },
            { type: 'manual_upload', label: 'Upload Transcript Manually' }
        ]
    };
}

/**
 * Try Option 1: Fetch native transcript via Graph API
 */
async function tryOption1(accessToken, meetingId, joinUrl) {
    try {
        // First check access
        const accessCheck = await checkTranscriptAccess(accessToken, joinUrl || meetingId);

        if (accessCheck.status !== AccessStatus.ACCESSIBLE) {
            return {
                success: false,
                error: `Access denied: ${accessCheck.status}`,
                reason: accessCheck.reason
            };
        }

        // Fetch the transcript
        const vttContent = await fetchTeamsTranscript(accessToken, joinUrl || meetingId);

        if (!vttContent || vttContent.length === 0) {
            return {
                success: false,
                error: 'Empty transcript returned'
            };
        }

        // Ingest into our system
        const meeting = await ingestTranscript({
            meetingId,
            source: TranscriptSource.GRAPH_API,
            content: vttContent,
            metadata: {
                fetchedAt: new Date().toISOString(),
                method: 'option_1_graph_api'
            }
        });

        return {
            success: true,
            meeting
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Try Option 2: Request bot to join and record
 */
async function tryOption2(meetingId, joinUrl, options = {}) {
    try {
        const botSession = await requestBotJoin(joinUrl, {
            disclosureMessage: options.disclosureMessage ||
                "MeetingAI is recording this meeting to provide summaries and action items.",
            enableTranscription: true
        });

        if (botSession.status === BotStatus.ERROR) {
            return {
                success: false,
                error: 'Bot failed to join'
            };
        }

        // Bot session initiated - transcript will be available later
        return {
            success: true,
            status: ProcessingStatus.OPTION_2_ACTIVE,
            sessionId: botSession.sessionId
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Complete processing for a bot session that has finished recording.
 * Called when bot session completes.
 */
export async function completeBotSession(sessionId, meetingId) {
    console.log(`\n🤖 Completing bot session: ${sessionId}`);

    try {
        const transcriptResult = await getBotTranscript(sessionId);

        if (!transcriptResult.transcript) {
            return {
                success: false,
                error: 'No transcript from bot session'
            };
        }

        // Ingest the bot-generated transcript
        const meeting = await ingestTranscript({
            meetingId,
            source: TranscriptSource.BOT_STT,
            content: transcriptResult.transcript,
            metadata: {
                sessionId,
                fetchedAt: new Date().toISOString(),
                method: 'option_2_bot'
            }
        });

        return {
            success: true,
            meeting
        };
    } catch (error) {
        console.error('completeBotSession error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Handle manual transcript upload (fallback path)
 */
export async function handleManualUpload(meetingId, content, filename) {
    console.log(`\n📤 Manual upload for meeting: ${meetingId}`);

    return await ingestTranscript({
        meetingId,
        source: TranscriptSource.MANUAL_UPLOAD,
        content,
        metadata: {
            filename,
            uploadedAt: new Date().toISOString(),
            method: 'manual_upload'
        }
    });
}

/**
 * Handle Power Automate webhook (alternative fallback)
 */
export async function handlePowerAutomateIngestion(payload) {
    const { meetingId, transcriptContent, metadata } = payload;

    console.log(`\n⚡ Power Automate ingestion for meeting: ${meetingId}`);

    return await ingestTranscript({
        meetingId,
        source: TranscriptSource.POWER_AUTOMATE,
        content: transcriptContent,
        metadata: {
            ...metadata,
            method: 'power_automate'
        }
    });
}
