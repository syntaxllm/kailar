import { NextResponse } from 'next/server';
import { ingestTeamsMeeting } from '../../../../lib/backend-adapter.js';

/**
 * POST /api/ingest/teams
 * Body: { accessToken: string, teamsMeetingId: string }
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { accessToken, teamsMeetingId } = body;

        if (!accessToken || !teamsMeetingId) {
            return NextResponse.json({ error: 'accessToken and teamsMeetingId are required' }, { status: 400 });
        }

        // Trigger real-world ingestion from MS Graph to MongoDB
        const meeting = await ingestTeamsMeeting(accessToken, teamsMeetingId);

        return NextResponse.json({
            success: true,
            meetingId: meeting.meetingId,
            message: 'Meeting successfully ingested from Microsoft Teams'
        });
    } catch (error) {
        console.error('Teams Ingestion Failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
