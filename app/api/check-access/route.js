/**
 * Transcript Access Check API
 * 
 * Checks if the current user can access transcripts for a meeting.
 * Used by the UI to show appropriate actions (ingest vs request consent).
 * 
 * GET /api/check-access?meetingId=xxx
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkTranscriptAccess, AccessStatus } from '../../../lib/ms-graph.js';
import { checkConsent, ConsentStatus } from '../../../lib/consent-manager.js';
import { getMeeting } from '../../../lib/storage-prod.js';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const meetingId = searchParams.get('meetingId');
        const joinUrl = searchParams.get('joinUrl');

        if (!meetingId && !joinUrl) {
            return NextResponse.json({ error: 'meetingId or joinUrl required' }, { status: 400 });
        }

        // GLOBAL SYNC: Check if meeting is already in our shared database (One-to-Many logic)
        const existing = await getMeeting(meetingId);
        if (existing) {
            return NextResponse.json({
                meetingId,
                status: 'ingested',
                canIngest: false,
                isCaptured: true,
                capturedAt: existing.importedAt
            });
        }

        const cookieStore = await cookies();
        const tokenCookie = cookieStore.get('ms_token');

        if (!tokenCookie) {
            return NextResponse.json({
                error: 'Not authenticated',
                accessStatus: 'unauthenticated'
            }, { status: 401 });
        }

        const tokenData = JSON.parse(tokenCookie.value);
        const accessToken = tokenData.access_token;

        // NEW: Check if bot is currently active for this meeting
        let botStatus = 'idle';
        try {
            const botSvcUrl = process.env.BOT_SERVICE_URL || 'http://localhost:6767';
            const botCheck = await fetch(`${botSvcUrl}/status-by-meeting/${meetingId}`);
            if (botCheck.ok) {
                const bData = await botCheck.json();
                botStatus = bData.status; // 'joining', 'joined', 'recording', etc.
            }
        } catch (e) { }

        // Check our consent database first
        const consent = await checkConsent(meetingId || joinUrl);

        // If we have consent recorded, also check if Graph API access works
        let graphAccess = null;
        try {
            graphAccess = await checkTranscriptAccess(accessToken, joinUrl || meetingId);
        } catch (err) {
            console.warn('Graph access check failed:', err.message);
        }

        // Determine final status
        let finalStatus = 'unknown';
        let canIngest = false;
        let needsConsent = false;

        if (botStatus !== 'idle' && botStatus !== 'completed' && botStatus !== 'error') {
            finalStatus = (botStatus === 'joined' || botStatus === 'recording') ? 'recording' : 'bot_joining';
            canIngest = false;
        } else {
            // Default to requiring the bot assistant
            finalStatus = 'bot_required';
            canIngest = false;
        }

        return NextResponse.json({
            meetingId: meetingId || joinUrl,
            status: finalStatus,
            canIngest,
            needsConsent,
            consent: {
                status: consent.status,
                grantedAt: consent.grantedAt
            },
            graphAccess: graphAccess ? {
                status: graphAccess.status,
                hasAccess: graphAccess.hasAccess,
                transcriptsExist: graphAccess.transcriptsExist
            } : null
        });
    } catch (error) {
        console.error('GET /api/check-access error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
