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

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const meetingId = searchParams.get('meetingId');
        const joinUrl = searchParams.get('joinUrl');

        if (!meetingId && !joinUrl) {
            return NextResponse.json({ error: 'meetingId or joinUrl required' }, { status: 400 });
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

        if (graphAccess?.status === AccessStatus.ACCESSIBLE) {
            finalStatus = 'accessible';
            canIngest = true;
        } else if (consent.status === ConsentStatus.GRANTED) {
            // We have consent but Graph failed - might need to retry
            finalStatus = 'consent_granted_pending';
            canIngest = true;
        } else if (graphAccess?.status === AccessStatus.NEEDS_PERMISSION) {
            finalStatus = 'needs_permission';
            needsConsent = true;
        } else if (graphAccess?.status === AccessStatus.NOT_AVAILABLE) {
            finalStatus = 'no_transcript';
            canIngest = false;
        } else {
            finalStatus = 'unknown';
            needsConsent = true;
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
