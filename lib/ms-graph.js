/**
 * MS Graph Service (Production)
 * Handles Transcripts, Recordings, and Meeting Metadata
 */

/**
 * NEW: List Recent Meetings
 * Fetches recent online meetings for the user's dashboard
 */
export async function listRecentMeetings(accessToken) {
    // Note: Graph API doesn't have a simple "recent meetings" for a user
    // We use the calendar view to find meetings in the last 7 days that were online
    const now = new Date();
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Format: YYYY-MM-DDTHH:mm:ss.sssZ
    const start = lastWeek.toISOString();
    const end = now.toISOString();

    const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}&$filter=isOnlineMeeting eq true&$orderby=start/dateTime desc&$top=10`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        throw new Error(`Recent Meetings Error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();

    // Map to a cleaner format
    return data.value.map(m => ({
        id: m.onlineMeeting?.joinUrl || m.id, // Prefer joinUrl as unique ID context
        subject: m.subject,
        start: m.start.dateTime,
        end: m.end.dateTime,
        webUrl: m.onlineMeeting?.joinUrl
    }));
}

export async function fetchTeamsTranscript(accessToken, meetingId) {
    const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}/transcripts`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) throw new Error(`Transcript List Error: ${response.status}`);
    const data = await response.json();

    if (!data.value || data.value.length === 0) throw new Error('No transcripts found.');

    // Fetch actual VTT content
    const contentUrl = `${url}/${data.value[0].id}/content`;
    const contentRes = await fetch(contentUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    return await contentRes.text();
}

/**
 * NEW: Fetch Recording Metadata and Download URL
 * Requires: OnlineMeetingRecording.Read.All
 */
export async function fetchTeamsRecording(accessToken, meetingId) {
    const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}/recordings`;

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
export async function getMeetingInfo(accessToken, meetingId) {
    const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    return await response.json();
}
