import { NextResponse } from 'next/server';
import { listRecentMeetings, checkTranscriptAccess, getMeetingInfo } from '../../../../lib/ms-graph.js';
import { loadTranscripts } from '../../../../lib/backend-adapter.js';

export async function GET(request) {
    const token = request.cookies.get('ms_token')?.value;

    if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // 1) Get already ingested meetings from our app FIRST
        const ingested = await loadTranscripts();
        const ingestedExternalIds = new Set(
            (ingested || [])
                .filter(m => m.source === 'Microsoft Teams API' && m.externalId)
                .map(m => m.externalId)
        );

        // 2) Get recent online meetings from user's calendar (organizer OR attendee)
        const recentMeetings = await listRecentMeetings(token);
        console.log(`Found ${recentMeetings.length} recent online meetings from calendar`);

        // 3) Filter out meetings that are already ingested
        const notIngested = (recentMeetings || []).filter(m => {
            // Check both the id and onlineMeetingId to catch duplicates
            const isIngested = ingestedExternalIds.has(m.id) || 
                              (m.onlineMeetingId && ingestedExternalIds.has(m.onlineMeetingId));
            return !isIngested;
        });

        console.log(`${notIngested.length} meetings not yet ingested (out of ${recentMeetings.length} total)`);

        if (notIngested.length === 0) {
            console.log('All meetings already ingested');
            return NextResponse.json([]);
        }

        // 4) Check transcript access status for each meeting
        // For attendees: if meeting exists in their calendar, assume transcripts might exist
        const transcriptChecks = await Promise.all(
            notIngested.map(async (m) => {
                let accessStatus;
                try {
                    accessStatus = await checkTranscriptAccess(token, m.id);
                } catch (err) {
                    console.warn(`Failed to check transcript access for meeting ${m.id}:`, err);
                    // If check fails, assume user might need permission (for attendees)
                    accessStatus = { hasAccess: false, transcriptsExist: true, needsPermission: true };
                }
                
                // Always try to get organizer info for meetings where permission might be needed
                // This helps attendees request access
                let organizerEmail = null;
                let organizerName = null;
                if (accessStatus.needsPermission || !accessStatus.hasAccess) {
                    try {
                        const meetingInfo = await getMeetingInfo(token, m.id);
                        // Try different paths for organizer info
                        organizerEmail = meetingInfo.participants?.organizer?.identity?.user?.email || 
                                        meetingInfo.participants?.organizer?.upn ||
                                        meetingInfo.organizer?.emailAddress?.address ||
                                        meetingInfo.organizer?.emailAddress?.name;
                        organizerName = meetingInfo.participants?.organizer?.identity?.user?.displayName ||
                                       meetingInfo.organizer?.emailAddress?.name ||
                                       meetingInfo.participants?.organizer?.identity?.user?.id ||
                                       'Meeting Organizer';
                    } catch (err) {
                        console.warn('Could not fetch organizer info:', err);
                        // Still show the meeting, just without organizer details
                    }
                }
                
                return {
                    meeting: m,
                    ...accessStatus,
                    organizerEmail,
                    organizerName
                };
            })
        );

        // 5) Return meetings where:
        //    - Transcripts exist AND user has access (can ingest)
        //    - Transcripts might exist BUT user needs permission (can request)
        // This shows meetings to attendees even if we can't verify transcripts exist
        const available = transcriptChecks
            .filter(c => {
                // Show if: transcripts confirmed exist OR user needs permission (likely transcripts exist)
                return c.transcriptsExist === true || c.needsPermission === true;
            })
            .map(c => ({
                ...c.meeting,
                hasAccess: c.hasAccess,
                needsPermission: c.needsPermission,
                organizerEmail: c.organizerEmail,
                organizerName: c.organizerName
            }));

        const withAccess = available.filter(m => m.hasAccess).length;
        const needPermission = available.filter(m => m.needsPermission).length;
        console.log(`Returning ${available.length} meetings: ${withAccess} with access, ${needPermission} need permission`);
        
        if (available.length === 0 && notIngested.length > 0) {
            console.warn(`WARNING: ${notIngested.length} meetings found but none have accessible transcripts. This might indicate permission issues for attendees.`);
        }
        
        return NextResponse.json(available);
    } catch (error) {
        console.error('Error in /api/teams/recent:', error);
        return NextResponse.json({ error: error.message || 'Failed to load recent Teams meetings.' }, { status: 500 });
    }
}
