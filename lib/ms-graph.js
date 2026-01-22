/**
 * MS Graph Service (Production)
 * Handles Transcripts, Recordings, and Meeting Metadata
 */

/**
 * List Recent Meetings (Organizer OR Attendee)
 * Fetches recent online meetings from the user's calendar where they participated
 * (as organizer or attendee). This works for both roles.
 */
export async function listRecentMeetings(accessToken) {
    // Note: Graph API doesn't have a simple "recent meetings" for a user
    // We use the calendar view to find meetings in the last 7 days that were online
    // This includes meetings where user is organizer OR attendee
    const now = new Date();
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Format: YYYY-MM-DDTHH:mm:ss.sssZ
    const start = lastWeek.toISOString();
    const end = now.toISOString();

    // Get all calendar events (includes meetings where user is organizer OR attendee)
    const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime desc&$top=50`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        // If it still fails, just return empty list to protect UI
        console.error(`Recent Meetings Error: ${response.status} ${await response.text()}`);
        return [];
    }

    const data = await response.json();

    // Map to a cleaner format (Filter only online meetings)
    // Some events might be "isOnlineMeeting: true"
    return data.value
        .filter(m => m.isOnlineMeeting === true)
        .slice(0, 20) // Increased limit to give more options
        .map(m => ({
            // IMPORTANT: Prefer onlineMeeting.id if available (works for both organizer and attendee)
            // Otherwise fall back to joinUrl which we'll resolve later
            id: m.onlineMeeting?.id || m.onlineMeeting?.joinUrl || m.id,
            subject: m.subject,
            start: m.start.dateTime,
            end: m.end.dateTime,
            webUrl: m.onlineMeeting?.joinUrl,
            // Store the onlineMeeting object for easier resolution
            onlineMeetingId: m.onlineMeeting?.id
        }));
}

/**
 * Check transcript access status for a Teams meeting.
 * Returns detailed status: whether transcripts exist AND whether user has access.
 *
 * Returns:
 *   - { hasAccess: true, transcriptsExist: true } => User can access transcripts
 *   - { hasAccess: false, transcriptsExist: true, needsPermission: true } => Transcripts exist but user needs permission
 *   - { hasAccess: false, transcriptsExist: false } => No transcripts available
 */
export async function checkTranscriptAccess(accessToken, meetingIdOrUrl) {
    try {
        let resolvedId;
        try {
            resolvedId = await resolveOnlineMeetingId(accessToken, meetingIdOrUrl);
        } catch (resolveErr) {
            // If we can't resolve the meeting ID (common for attendees), 
            // assume the meeting exists (it's in their calendar) and they need permission
            console.log(`Could not resolve meeting ID (likely attendee): ${resolveErr.message}`);
            return { hasAccess: false, transcriptsExist: true, needsPermission: true };
        }

        const transcriptsUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${resolvedId}/transcripts`;

        const response = await fetch(transcriptsUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        // 404 = No transcript available OR no access (can't distinguish for attendees)
        if (response.status === 404) {
            // For attendees, 404 often means they don't have access, not that transcripts don't exist
            // Try to verify meeting exists - if it does, assume transcripts might exist
            try {
                const meetingInfo = await getMeetingInfo(accessToken, resolvedId);
                // Meeting exists - for attendees, assume transcripts might exist but need permission
                return { hasAccess: false, transcriptsExist: true, needsPermission: true };
            } catch (infoErr) {
                // Can't access meeting info - might be attendee without access
                // Still assume transcripts might exist (meeting is in their calendar)
                console.log(`Could not get meeting info (likely attendee): ${infoErr.message}`);
                return { hasAccess: false, transcriptsExist: true, needsPermission: true };
            }
        }

        // 403 = Forbidden - transcripts exist but user doesn't have permission
        if (response.status === 403) {
            return { hasAccess: false, transcriptsExist: true, needsPermission: true };
        }

        // Any other non-OK status = Likely permission issue for attendees
        if (!response.ok) {
            console.warn(`checkTranscriptAccess: non-ok status ${response.status} for meeting ${resolvedId}`);
            // For non-OK status, assume user might need permission (especially for attendees)
            return { hasAccess: false, transcriptsExist: true, needsPermission: true };
        }

        const data = await response.json();
        
        // STRICT CHECK: Must have at least one transcript in the array
        const hasTranscripts = Array.isArray(data.value) && data.value.length > 0;
        
        if (hasTranscripts) {
            return { hasAccess: true, transcriptsExist: true, needsPermission: false };
        } else {
            // Empty array - transcripts endpoint exists but no transcripts yet
            return { hasAccess: false, transcriptsExist: false, needsPermission: false };
        }
    } catch (err) {
        console.warn(`checkTranscriptAccess failed for meeting:`, err?.message || err);
        // On error, assume transcripts might exist but user needs permission (especially for attendees)
        return { hasAccess: false, transcriptsExist: true, needsPermission: true };
    }
}

/**
 * Legacy function for backward compatibility
 * Returns true only if user has access to transcripts
 */
export async function hasTeamsTranscript(accessToken, meetingIdOrUrl) {
    const status = await checkTranscriptAccess(accessToken, meetingIdOrUrl);
    return status.hasAccess === true;
}
/**
 * Resolve a Teams meeting identifier to the actual `onlineMeeting` ID needed
 * for transcripts/recordings APIs. Works for both organizers and attendees.
 *
 * - If the input already looks like an ID (non-URL), it's returned as-is.
 * - If it's a join URL, we try multiple methods:
 *   1. Query /me/onlineMeetings?$filter=joinWebUrl eq '...' (works for organizer)
 *   2. Query /me/onlineMeetings (list all) and find by joinWebUrl (works for attendee)
 */
async function resolveOnlineMeetingId(accessToken, meetingKey) {
    if (!meetingKey) throw new Error('MISSING_MEETING_IDENTIFIER');

    // Heuristic: if it looks like a URL, treat it as joinWebUrl
    const isUrl = typeof meetingKey === 'string' && /^https?:\/\//i.test(meetingKey);
    if (!isUrl) {
        // Already looks like an ID, return as-is
        return meetingKey;
    }

    // Method 1: Try filter query (works for organizers)
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
        console.warn('Filter query failed, trying alternative method:', err?.message);
    }

    // Method 2: List all onlineMeetings and find by joinWebUrl (works for attendees)
    // Note: This might be slower but works for both organizer and attendee roles
    try {
        const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings?$top=100`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.value && Array.isArray(data.value)) {
                const match = data.value.find(m => m.joinWebUrl === meetingKey);
                if (match) {
                    return match.id;
                }
            }
        }
    } catch (err) {
        console.warn('List query failed:', err?.message);
    }

    // If both methods fail, throw error
    throw new Error('NO_ONLINE_MEETING_FOR_JOIN_URL');
}

export async function fetchTeamsTranscript(accessToken, meetingIdOrUrl) {
    const resolvedId = await resolveOnlineMeetingId(accessToken, meetingIdOrUrl);
    const baseUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${resolvedId}`;
    const transcriptsUrl = `${baseUrl}/transcripts`;

    const response = await fetch(transcriptsUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    // IMPORTANT:
    // A 404 here is usually *not* a server bug – it means Graph has
    // no transcripts for this meeting ID (wrong ID, no transcription, or
    // feature not enabled). We surface this as a clean, semantic error
    // instead of an opaque 500 in the API route.
    if (response.status === 404) {
        console.warn(`Transcript not found for meeting ${resolvedId}: 404`);
        throw new Error('NO_TRANSCRIPTS_FOR_MEETING');
    }

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Transcript List Error ${response.status}:`, errorText);
        throw new Error(`Transcript List Error: ${response.status}`);
    }
    
    const data = await response.json();

    if (!data.value || data.value.length === 0) {
        console.warn(`No transcripts in response for meeting ${resolvedId}`);
        throw new Error('NO_TRANSCRIPTS_FOR_MEETING');
    }

    const transcript = data.value[0];
    console.log(`Found transcript ${transcript.id} for meeting ${resolvedId}`);

    // Microsoft Graph API provides transcript content via transcriptContentUrl property
    // OR via the /content endpoint. Try both approaches.
    let contentUrl = null;
    
    // Method 1: Check if transcriptContentUrl is provided directly
    if (transcript.transcriptContentUrl) {
        contentUrl = transcript.transcriptContentUrl;
        console.log(`Using transcriptContentUrl: ${contentUrl}`);
    } else {
        // Method 2: Use the /content endpoint
        contentUrl = `${transcriptsUrl}/${transcript.id}/content`;
        console.log(`Using content endpoint: ${contentUrl}`);
    }

    const contentRes = await fetch(contentUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!contentRes.ok) {
        const errorText = await contentRes.text();
        console.error(`Transcript Content Error ${contentRes.status}:`, errorText);
        throw new Error(`Transcript Content Error: ${contentRes.status}`);
    }

    const vttContent = await contentRes.text();
    
    // Validate that we actually got content
    if (!vttContent || vttContent.trim().length === 0) {
        console.error(`Empty transcript content for meeting ${resolvedId}`);
        throw new Error('EMPTY_TRANSCRIPT_CONTENT');
    }

    console.log(`Successfully fetched transcript content (${vttContent.length} chars) for meeting ${resolvedId}`);
    return vttContent;
}

/**
 * NEW: Fetch Recording Metadata and Download URL
 * Requires: OnlineMeetingRecording.Read.All
 */
export async function fetchTeamsRecording(accessToken, meetingIdOrUrl) {
    const resolvedId = await resolveOnlineMeetingId(accessToken, meetingIdOrUrl);
    const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${resolvedId}/recordings`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) throw new Error(`Recording List Error: ${response.status}`);
    const data = await response.json();

    if (!data.value || data.value.length === 0) return null;

    // This returns metadata including 'contentUrl' which is the download link
    return data.value[0];
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
