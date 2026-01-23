/**
 * Consent API Route
 * 
 * Handles organizer consent grants for transcript access.
 * 
 * POST /api/consent - Grant consent for a meeting
 * GET /api/consent?meetingId=xxx - Check consent status
 */

import { NextResponse } from 'next/server';
import { grantConsent, checkConsent, requestConsent } from '../../../lib/consent-manager.js';

/**
 * GET - Check consent status for a meeting
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const meetingId = searchParams.get('meetingId');

        if (!meetingId) {
            return NextResponse.json({ error: 'meetingId required' }, { status: 400 });
        }

        const consent = await checkConsent(meetingId);

        return NextResponse.json({
            meetingId,
            ...consent
        });
    } catch (error) {
        console.error('GET /api/consent error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * POST - Grant or request consent
 * 
 * Body:
 * - meetingId: string
 * - action: 'grant' | 'request'
 * - organizerEmail: string (for grant)
 * - attendeeEmail: string (for request)
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { meetingId, action, organizerEmail, attendeeEmail, method } = body;

        if (!meetingId) {
            return NextResponse.json({ error: 'meetingId required' }, { status: 400 });
        }

        if (action === 'grant') {
            if (!organizerEmail) {
                return NextResponse.json({ error: 'organizerEmail required for grant' }, { status: 400 });
            }

            await grantConsent(meetingId, organizerEmail, method || 'manual');

            return NextResponse.json({
                success: true,
                message: 'Consent granted',
                meetingId
            });
        }

        if (action === 'request') {
            if (!organizerEmail || !attendeeEmail) {
                return NextResponse.json({
                    error: 'organizerEmail and attendeeEmail required for request'
                }, { status: 400 });
            }

            await requestConsent(meetingId, organizerEmail, attendeeEmail);

            return NextResponse.json({
                success: true,
                message: 'Consent request sent',
                meetingId
            });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('POST /api/consent error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
