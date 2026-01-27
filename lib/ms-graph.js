/**
 * MS Graph Service (Hybrid Architecture)
 * 
 * Handles:
 * - Transcript access checking (Option 1 gate)
 * - Fetching transcripts and recordings
 * - Meeting metadata
 * 
 * Supports both Organizer AND Attendee roles.
 */

/**
 * Access Status Enum
 */
export const AccessStatus = {
    ACCESSIBLE: 'accessible',           // User can access transcripts
    NEEDS_PERMISSION: 'needs_permission', // Transcripts exist but user needs consent
    NOT_AVAILABLE: 'not_available',       // No transcripts exist
    ERROR: 'error'                        // Could not determine
};

/**
 * List Upcoming Meetings (Organizer OR Attendee)
 * Fetches upcoming online meetings from the user's calendar for the next 7 days
 */
export async function listRecentMeetings(accessToken) {
    const now = new Date();
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const start = now.toISOString();
    const end = nextWeek.toISOString();

    // Get all calendar events with attendee details
    const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime asc&$top=50&$select=id,subject,start,end,isOnlineMeeting,onlineMeeting,isOrganizer,organizer,attendees`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        console.error(`Upcoming Meetings Error: ${response.status} ${await response.text()}`);
        return [];
    }

    const data = await response.json();

    // TEMPORARY DEBUGGING
    console.log('--- MS Graph API Response ---');
    console.log(JSON.stringify(data, null, 2));
    console.log('-----------------------------');

    // Filter for online meetings and map to clean format
    return data.value
        .filter(m => m.isOnlineMeeting === true)
        .slice(0, 20)
        .map(m => {
            // Parse attendees
            const attendees = (m.attendees || []).map(a => ({
                name: a.emailAddress?.name || a.emailAddress?.address?.split('@')[0] || 'Unknown',
                email: a.emailAddress?.address || '',
                status: a.status?.response || 'none'
            }));

            // Convert UTC times to local ISO strings for consistent parsing
            const startUtc = m.start.dateTime + (m.start.dateTime.endsWith('Z') ? '' : 'Z');
            const endUtc = m.end.dateTime + (m.end.dateTime.endsWith('Z') ? '' : 'Z');

            return {
                id: m.onlineMeeting?.id || m.id,
                subject: m.subject || 'Untitled Meeting',
                startUtc: startUtc,
                endUtc: endUtc,
                startLocal: new Date(startUtc).toISOString(),
                endLocal: new Date(endUtc).toISOString(),
                timeZone: m.start.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                webUrl: m.onlineMeeting?.joinUrl,
                joinUrl: m.onlineMeeting?.joinUrl,
                isOrganizer: m.isOrganizer || false,
                organizerEmail: m.organizer?.emailAddress?.address || null,
                organizerName: m.organizer?.emailAddress?.name || null,
                attendees: attendees,
                attendeeCount: attendees.length
            };
        });
}

/**
 * Check transcript access status for a Teams meeting.
 * This is the GATE for deciding Option 1 vs Option 2.
 * 
 * @returns {Promise<{status: string, hasAccess: boolean, transcriptsExist: boolean}>}
 */
export async function checkTranscriptAccess(accessToken, meetingIdOrUrl) {
    try {
        let resolvedId;
        try {
            resolvedId = await resolveOnlineMeetingId(accessToken, meetingIdOrUrl);
        } catch (resolveErr) {
            // Can't resolve = likely attendee without access
            console.log(`Could not resolve meeting ID: ${resolveErr.message}`);
            return {
                status: AccessStatus.NEEDS_PERMISSION,
                hasAccess: false,
                transcriptsExist: true,
                reason: 'cannot_resolve_meeting'
            };
        }

        const transcriptsUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${resolvedId}/transcripts`;
        const response = await fetch(transcriptsUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        // 403 = Forbidden - transcripts exist but no permission
        if (response.status === 403) {
            return {
                status: AccessStatus.NEEDS_PERMISSION,
                hasAccess: false,
                transcriptsExist: true
            };
        }

        // 404 = Not found - could mean no transcripts OR no access
        if (response.status === 404) {
            return {
                status: AccessStatus.NEEDS_PERMISSION,
                hasAccess: false,
                transcriptsExist: true,
                reason: 'attendee_no_access'
            };
        }

        if (!response.ok) {
            console.warn(`checkTranscriptAccess: ${response.status}`);
            return {
                status: AccessStatus.ERROR,
                hasAccess: false,
                transcriptsExist: false
            };
        }

        const data = await response.json();
        const hasTranscripts = Array.isArray(data.value) && data.value.length > 0;

        if (hasTranscripts) {
            return {
                status: AccessStatus.ACCESSIBLE,
                hasAccess: true,
                transcriptsExist: true
            };
        } else {
            return {
                status: AccessStatus.NOT_AVAILABLE,
                hasAccess: false,
                transcriptsExist: false
            };
        }
    } catch (err) {
        console.error('checkTranscriptAccess error:', err);
        return {
            status: AccessStatus.ERROR,
            hasAccess: false,
            transcriptsExist: false
        };
    }
}

/**
 * Resolve a meeting identifier (URL or ID) to the Graph API meeting ID.
 * Works for organizers; may fail for attendees (which indicates need for fallback).
 */
async function resolveOnlineMeetingId(accessToken, meetingKey) {
    if (!meetingKey) throw new Error('MISSING_MEETING_IDENTIFIER');

    // If not a URL, assume it's already an ID
    const isUrl = typeof meetingKey === 'string' && /^https?:\/\//i.test(meetingKey);
    if (!isUrl) return meetingKey;

    // Method 1: Filter query (works for organizers)
    try {
        const filter = encodeURIComponent(`joinWebUrl eq '${meetingKey}'`);
        const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings?$filter=${filter}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.value && data.value.length > 0) {
                return data.value[0].id;
            }
        }
    } catch (err) {
        console.warn('Filter query failed:', err?.message);
    }

    // Method 2: List and search (slower but may work for some cases)
    try {
        const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings?$top=100`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            const match = data.value?.find(m => m.joinWebUrl === meetingKey);
            if (match) return match.id;
        }
    } catch (err) {
        console.warn('List query failed:', err?.message);
    }

    throw new Error('NO_ONLINE_MEETING_FOR_JOIN_URL');
}

/**
 * Fetch Teams Transcript (Option 1 path)
 * Returns VTT content if user has access.
 */
export async function fetchTeamsTranscript(accessToken, meetingIdOrUrl) {
    const resolvedId = await resolveOnlineMeetingId(accessToken, meetingIdOrUrl);
    const transcriptsUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${resolvedId}/transcripts`;

    const response = await fetch(transcriptsUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (response.status === 404) {
        throw new Error('NO_TRANSCRIPTS_FOR_MEETING');
    }

    if (response.status === 403) {
        throw new Error('PERMISSION_DENIED');
    }

    if (!response.ok) {
        throw new Error(`Transcript List Error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.value || data.value.length === 0) {
        throw new Error('NO_TRANSCRIPTS_FOR_MEETING');
    }

    // Fetch VTT content
    const transcript = data.value[0];
    const contentUrl = transcript.transcriptContentUrl ||
        `${transcriptsUrl}/${transcript.id}/content`;

    const contentRes = await fetch(contentUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!contentRes.ok) {
        throw new Error(`Transcript Content Error: ${contentRes.status}`);
    }

    return await contentRes.text();
}

/**
 * Fetch Recording Metadata
 */
export async function fetchTeamsRecording(accessToken, meetingIdOrUrl) {
    const resolvedId = await resolveOnlineMeetingId(accessToken, meetingIdOrUrl);
    const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${resolvedId}/recordings`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.value?.[0] || null;
}

/**
 * Get Meeting Info (Subject, Attendees, etc)
 */
export async function getMeetingInfo(accessToken, meetingIdOrUrl) {
    const resolvedId = await resolveOnlineMeetingId(accessToken, meetingIdOrUrl);
    const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${resolvedId}`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    return await response.json();
}

/**
 * Find the currently active meeting from a list of meetings.
 * Helper for the "Magic Join" feature.
 */
export function findCurrentMeeting(meetings) {
    if (!meetings || !Array.isArray(meetings)) return null;

    const now = new Date();
    // Buffer: Meeting started up to 15 mins ago or starting in next 5 mins
    const bufferPast = 15 * 60 * 1000;
    const bufferFuture = 5 * 60 * 1000;

    return meetings.find(m => {
        const start = new Date(m.startLocal || m.startUtc);
        const end = new Date(m.endLocal || m.endUtc);

        // It's "current" if:
        // 1. We are within the scheduled time window
        // 2. OR it started recently (late join)
        // 3. OR it starts very soon (early join)
        const isActive = (now >= new Date(start.getTime() - bufferFuture)) && (now <= end);
        return isActive;
    }) || null;
}
