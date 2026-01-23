/**
 * Consent Manager
 * 
 * Handles checking and storing organizer consent for transcript access.
 * This is the "gate" that decides Option 1 (native) vs Option 2 (bot).
 * 
 * Consent Model:
 * - Stored in MongoDB with meeting/organizer context
 * - Can be granted pre-meeting (ideal) or post-meeting (fallback)
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
 * Consent Status Enum
 */
export const ConsentStatus = {
    GRANTED: 'granted',      // Organizer approved
    PENDING: 'pending',      // Request sent, awaiting response
    DENIED: 'denied',        // Explicitly denied
    NOT_REQUESTED: 'not_requested',  // No request made yet
    UNKNOWN: 'unknown'       // Can't determine (external meeting, etc.)
};

/**
 * Check if we have consent for a specific meeting.
 * 
 * @param {string} meetingId - The Teams meeting ID or join URL
 * @param {string} organizerEmail - Email of the meeting organizer (optional)
 * @returns {Promise<{status: string, grantedAt?: Date, method?: string}>}
 */
export async function checkConsent(meetingId, organizerEmail = null) {
    const database = await connect();
    const collection = database.collection('consents');

    // Look up consent by meeting ID
    const consent = await collection.findOne({ meetingId });

    if (consent) {
        return {
            status: consent.status,
            grantedAt: consent.grantedAt,
            method: consent.method,  // 'pre_meeting', 'post_meeting', 'admin'
            organizerEmail: consent.organizerEmail
        };
    }

    return { status: ConsentStatus.NOT_REQUESTED };
}

/**
 * Record consent grant for a meeting.
 * Called when organizer clicks "Enable transcript access" or admin grants.
 * 
 * @param {string} meetingId 
 * @param {string} organizerEmail 
 * @param {string} method - How consent was obtained
 */
export async function grantConsent(meetingId, organizerEmail, method = 'manual') {
    const database = await connect();
    const collection = database.collection('consents');

    await collection.updateOne(
        { meetingId },
        {
            $set: {
                meetingId,
                organizerEmail,
                status: ConsentStatus.GRANTED,
                grantedAt: new Date(),
                method
            }
        },
        { upsert: true }
    );

    console.log(`✅ Consent granted for meeting ${meetingId} by ${organizerEmail}`);
}

/**
 * Record a consent request (waiting for organizer response)
 */
export async function requestConsent(meetingId, organizerEmail, attendeeEmail) {
    const database = await connect();
    const collection = database.collection('consents');

    await collection.updateOne(
        { meetingId },
        {
            $set: {
                meetingId,
                organizerEmail,
                status: ConsentStatus.PENDING,
                requestedAt: new Date(),
                requestedBy: attendeeEmail
            }
        },
        { upsert: true }
    );

    console.log(`📨 Consent request sent for meeting ${meetingId}`);
}

/**
 * Check if we should use Bot fallback (Option 2)
 * 
 * Decision Logic:
 * - If consent is GRANTED → Use native Graph API (Option 1)
 * - If consent is NOT_REQUESTED or PENDING or DENIED → Use Bot (Option 2)
 */
export async function shouldUseBotFallback(meetingId) {
    const consent = await checkConsent(meetingId);

    // Only skip bot if we have explicit granted consent
    if (consent.status === ConsentStatus.GRANTED) {
        return { useBot: false, reason: 'consent_granted' };
    }

    return {
        useBot: true,
        reason: `consent_${consent.status}`,
        consentStatus: consent.status
    };
}
