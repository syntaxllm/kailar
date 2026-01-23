/**
 * Consent Manager (Simplified)
 * 
 * Now optional - used to track when Graph API access is available
 * as a "bonus" path (free, higher quality transcription).
 * 
 * Bot is the primary method, so consent is no longer blocking.
 */

import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL;
const MONGO_DB = process.env.MONGO_DB || 'meeting_ai_prod';

let db = null;

async function connect() {
    if (db) return db;
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db(MONGO_DB);
    return db;
}

/**
 * Check if we have recorded Graph API access for a meeting
 */
export async function checkGraphAccess(meetingId) {
    try {
        const database = await connect();
        const record = await database.collection('graph_access').findOne({ meetingId });

        if (record && record.hasAccess) {
            return { hasAccess: true, recordedAt: record.recordedAt };
        }

        return { hasAccess: false };
    } catch (err) {
        console.warn('checkGraphAccess error:', err);
        return { hasAccess: false };
    }
}

/**
 * Record that Graph API access worked for a meeting
 * This helps us know "bonus path" is available for future requests
 */
export async function recordGraphAccess(meetingId, organizerEmail = null) {
    try {
        const database = await connect();
        await database.collection('graph_access').updateOne(
            { meetingId },
            {
                $set: {
                    meetingId,
                    hasAccess: true,
                    organizerEmail,
                    recordedAt: new Date()
                }
            },
            { upsert: true }
        );
        console.log(`📝 Recorded Graph access for: ${meetingId}`);
    } catch (err) {
        console.warn('recordGraphAccess error:', err);
    }
}

// Legacy exports for backward compatibility
export const ConsentStatus = {
    GRANTED: 'granted',
    NOT_REQUESTED: 'not_requested'
};

export async function checkConsent(meetingId) {
    const access = await checkGraphAccess(meetingId);
    return {
        status: access.hasAccess ? ConsentStatus.GRANTED : ConsentStatus.NOT_REQUESTED,
        ...access
    };
}

export async function grantConsent(meetingId, organizerEmail, method) {
    return await recordGraphAccess(meetingId, organizerEmail);
}

export async function requestConsent() {
    // No longer needed - bot handles everything
    return { message: 'Consent requests deprecated - using bot' };
}

export async function shouldUseBotFallback() {
    // Always use bot as primary
    return { useBot: true, reason: 'bot_is_primary' };
}
