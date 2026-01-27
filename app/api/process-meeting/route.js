/**
 * Process Meeting API Route
 * 
 * Main endpoint for triggering meeting transcript processing.
 * Implements the hybrid decision flow.
 * 
 * POST /api/process-meeting
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { processMeeting, handleManualUpload } from '../../../lib/hybrid-processor.js';

/**
 * POST - Process a meeting for transcript ingestion
 * 
 * Body:
 * - meetingId: string
 * - joinUrl: string (optional)
 * - source: 'teams' | 'manual' (default: 'teams')
 * - content: string (for manual upload)
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { meetingId, joinUrl, source = 'teams', content, filename } = body;

        if (!meetingId) {
            return NextResponse.json({ error: 'meetingId required' }, { status: 400 });
        }

        // Handle manual upload
        if (source === 'manual') {
            if (!content) {
                return NextResponse.json({ error: 'content required for manual upload' }, { status: 400 });
            }

            const result = await handleManualUpload(meetingId, content, filename || 'uploaded.vtt');

            return NextResponse.json({
                success: true,
                method: 'manual_upload',
                meeting: {
                    meetingId: result.meetingId,
                    entries: result.entries?.length || 0
                }
            });
        }

        // Handle Teams meeting processing (hybrid flow)
        const cookieStore = await cookies();
        const tokenCookie = cookieStore.get('ms_token');

        if (!tokenCookie) {
            return NextResponse.json({
                error: 'Not authenticated. Please sign in with Microsoft.'
            }, { status: 401 });
        }

        let accessToken = tokenCookie.value;
        let userEmail = body.userEmail || 'unknown';

        // Check if cookie is JSON or raw string (legacy check)
        try {
            // If it happens to be a JSON object
            if (accessToken.startsWith('{')) {
                const tokenData = JSON.parse(accessToken);
                accessToken = tokenData.access_token;
                if (tokenData.userEmail) userEmail = tokenData.userEmail;
            }
        } catch (e) {
            // It's a raw string, which is expected from our auth callback
            console.log("Token is raw string (expected)");
        }

        // Run the hybrid processing
        const result = await processMeeting({
            meetingId,
            joinUrl,
            accessToken,
            userEmail
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error('POST /api/process-meeting error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
