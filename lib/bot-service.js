/**
 * Bot Service - Always-Join Architecture
 * 
 * The Bot ALWAYS joins meetings and operates in one of two modes:
 * 
 * Mode A: GRAPH_API (Transcription Enabler)
 *   - Bot joins and enables Teams native transcription
 *   - After meeting, app fetches transcript from Graph API
 *   - Cost: FREE (uses Microsoft's transcription)
 * 
 * Mode B: BOT_RECORDING (Backup Recorder)
 *   - Bot joins and records audio stream
 *   - Audio sent to STT service (Whisper/Azure/Deepgram)
 *   - Cost: $$$ (depends on audio length and STT provider)
 */

export const BotStatus = {
    IDLE: 'idle',
    JOINING: 'joining',
    IN_MEETING: 'in_meeting',
    RECORDING: 'recording',
    LEAVING: 'leaving',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    ERROR: 'error'
};

const BOT_SERVICE_URL = process.env.BOT_SERVICE_URL || null;
const STT_PROVIDER = process.env.STT_PROVIDER || 'whisper';

/**
 * Check if Bot Service is available
 */
export function isBotServiceAvailable() {
    return !!BOT_SERVICE_URL || process.env.NODE_ENV === 'development';
}

/**
 * Request Bot to join a meeting
 * 
 * @param {string} joinUrl - Teams meeting join URL
 * @param {object} options
 * @param {string} options.mode - 'graph_api' or 'bot_recording'
 * @param {boolean} options.enableTeamsTranscription - Should bot enable Teams transcription?
 * @param {boolean} options.recordAudio - Should bot record audio?
 */
export async function requestBotJoin(joinUrl, options = {}) {
    const {
        meetingId,
        mode = 'bot_recording',
        enableTeamsTranscription = false,
        recordAudio = true,
        disclosureMessage
    } = options;

    console.log(`🤖 Bot join requested`);
    console.log(`   URL: ${joinUrl}`);
    console.log(`   Mode: ${mode}`);
    console.log(`   Enable Teams Transcription: ${enableTeamsTranscription}`);
    console.log(`   Record Audio: ${recordAudio}`);

    const sessionId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Call external bot service
    if (BOT_SERVICE_URL) {
        try {
            const response = await fetch(`${BOT_SERVICE_URL}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    joinUrl,
                    meetingId,
                    mode,
                    enableTeamsTranscription,
                    recordAudio,
                    sttProvider: recordAudio ? STT_PROVIDER : null,
                    disclosureMessage: disclosureMessage ||
                        "MeetingAI Bot is here to provide meeting insights."
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Bot service error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            return {
                sessionId: data.sessionId || sessionId,
                status: data.status || BotStatus.JOINING,
                mode,
                message: data.message || 'Bot joining meeting'
            };
        } catch (err) {
            console.error('Bot service call failed:', err);
            return {
                sessionId,
                status: BotStatus.ERROR,
                error: err.message
            };
        }
    }

    // Development mode - mock response
    console.log(`   [DEV] Bot session created: ${sessionId}`);
    return {
        sessionId,
        status: BotStatus.JOINING,
        mode,
        message: '[DEV] Bot session initialized',
        joinUrl,
        createdAt: new Date().toISOString()
    };
}

/**
 * Get status of a bot session
 */
export async function getBotSessionStatus(sessionId) {
    if (BOT_SERVICE_URL) {
        try {
            const response = await fetch(`${BOT_SERVICE_URL}/status/${sessionId}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (err) {
            console.warn('Status check failed:', err);
        }
    }

    return {
        sessionId,
        status: BotStatus.IDLE,
        message: '[DEV] Status check - bot not connected'
    };
}

/**
 * Request bot to leave meeting
 */
export async function requestBotLeave(sessionId) {
    console.log(`🤖 Bot leave requested: ${sessionId}`);

    if (BOT_SERVICE_URL) {
        try {
            await fetch(`${BOT_SERVICE_URL}/leave/${sessionId}`, { method: 'POST' });
        } catch (err) {
            console.warn('Leave request failed:', err);
        }
    }

    return { sessionId, status: BotStatus.LEAVING };
}

/**
 * Get transcript from bot (for BOT_RECORDING mode)
 */
export async function getBotTranscript(sessionId) {
    if (BOT_SERVICE_URL) {
        try {
            const response = await fetch(`${BOT_SERVICE_URL}/transcript/${sessionId}`);
            if (response.ok) {
                const data = await response.json();
                return {
                    sessionId,
                    transcript: data.transcript,
                    source: 'bot_stt',
                    duration: data.duration
                };
            }
        } catch (err) {
            console.warn('Transcript fetch failed:', err);
        }
    }

    return {
        sessionId,
        transcript: null,
        source: 'bot_stt',
        message: '[DEV] No transcript - bot not connected'
    };
}

/**
 * Handle webhook from bot service
 */
export async function handleBotWebhook(event) {
    const { type, sessionId, data } = event;
    console.log(`🤖 Webhook: ${type} for ${sessionId}`);

    switch (type) {
        case 'joined':
            return { acknowledged: true, message: 'Bot joined meeting' };

        case 'transcription_enabled':
            return { acknowledged: true, message: 'Teams transcription enabled' };

        case 'recording_started':
            return { acknowledged: true, message: 'Audio recording started' };

        case 'meeting_ended':
            // This triggers transcript fetch
            return {
                acknowledged: true,
                message: 'Meeting ended - ready for transcript fetch',
                shouldFetchTranscript: true
            };

        case 'transcript_ready':
            return { acknowledged: true, message: 'Transcript from STT ready' };

        case 'error':
            console.error('Bot error:', data);
            return { acknowledged: true, error: data?.error };

        default:
            return { acknowledged: false, error: 'Unknown event' };
    }
}
