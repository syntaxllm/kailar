/**
 * MS Graph Service (Production)
 * Handles Transcripts, Recordings, and Meeting Metadata
 */

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
