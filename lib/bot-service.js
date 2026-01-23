/**
 * Bot Service - Core Recording Infrastructure
 * 
 * This is the PRIMARY method for transcript ingestion.
 * The bot joins meetings, captures audio, and produces transcripts via STT.
 * 
 * Implementation Options:
 * 1. Microsoft Graph Communications API (production - complex)
 * 2. Azure Communication Services
 * 3. External service (Recall.ai, Assembly.ai, etc.)
 * 4. Headless browser (MVP - simpler)
 * 
 * For MVP: We'll use a webhook-based approach where:
 * - Bot is a separate service that gets deployed
 * - This file provides the interface to that service
 */

/**
 * Bot Status
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

/**
 * Bot Configuration
 */
const BOT_SERVICE_URL = process.env.BOT_SERVICE_URL || null;
const STT_PROVIDER = process.env.STT_PROVIDER || 'whisper';

/**
 * Check if Bot Service is available
 */
export function isBotServiceAvailable() {
    // For now, return true if we have a service URL configured
    // OR if we're in development mode (for testing)
    return !!BOT_SERVICE_URL || process.env.NODE_ENV === 'development';
}

/**
 * Request Bot to join a meeting
 * 
 * @param {string} joinUrl - Teams meeting join URL
 * @param {object} options - Configuration
 * @returns {Promise<{sessionId: string, status: string}>}
 */
export async function requestBotJoin(joinUrl, options = {}) {
    const { meetingId, disclosureMessage } = options;

    console.log(`🤖 Bot join requested for: ${joinUrl}`);

    // Generate session ID
    const sessionId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // If we have an external bot service, call it
    if (BOT_SERVICE_URL) {
        try {
            const response = await fetch(`${BOT_SERVICE_URL}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    joinUrl,
                    meetingId,
                    disclosureMessage: disclosureMessage ||
                        "MeetingAI Bot is recording this meeting to provide summaries and action items.",
                    sttProvider: STT_PROVIDER
                })
            });

            if (!response.ok) {
                throw new Error(`Bot service error: ${response.status}`);
            }

            const data = await response.json();
            return {
                sessionId: data.sessionId || sessionId,
                status: data.status || BotStatus.JOINING,
                message: 'Bot joining meeting'
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
    console.log(`   [DEV MODE] Bot session created (mock): ${sessionId}`);
    return {
        sessionId,
        status: BotStatus.JOINING,
        message: '[DEV] Bot session initialized - actual bot integration pending',
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

    // Mock response for development
    return {
        sessionId,
        status: BotStatus.IDLE,
        message: '[DEV] Status check - actual bot not connected'
    };
}

/**
 * Request bot to leave meeting
 */
export async function requestBotLeave(sessionId) {
    console.log(`🤖 Bot leave requested: ${sessionId}`);

    if (BOT_SERVICE_URL) {
        try {
            const response = await fetch(`${BOT_SERVICE_URL}/leave/${sessionId}`, {
                method: 'POST'
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (err) {
            console.warn('Leave request failed:', err);
        }
    }

    return {
        sessionId,
        status: BotStatus.LEAVING,
        message: 'Bot leaving meeting'
    };
}

/**
 * Get transcript from completed bot session
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

    // Mock response for development
    return {
        sessionId,
        transcript: null,
        source: 'bot_stt',
        message: '[DEV] No transcript - actual bot not connected'
    };
}

/**
 * Webhook handler for bot events
 * Called by the external bot service when events occur
 */
export async function handleBotWebhook(event) {
    const { type, sessionId, data } = event;

    console.log(`🤖 Bot webhook: ${type} for session ${sessionId}`);

    switch (type) {
        case 'joined':
            // Bot successfully joined meeting
            return { acknowledged: true, message: 'Bot joined' };

        case 'recording_started':
            // Recording has started
            return { acknowledged: true, message: 'Recording started' };

        case 'recording_stopped':
            // Recording finished, transcript being processed
            return { acknowledged: true, message: 'Processing audio' };

        case 'transcript_ready':
            // Transcript is ready - store it
            // This would trigger ingestion
            return { acknowledged: true, message: 'Transcript received' };

        case 'error':
            console.error('Bot error:', data);
            return { acknowledged: true, error: data.error };

        default:
            return { acknowledged: false, error: 'Unknown event type' };
    }
}
