/**
 * Bot Status API
 * 
 * Retrieves real-time status (including current speaker) for a bot session.
 * 
 * GET /api/bot/status?sessionId=xxx
 */

import { NextResponse } from 'next/server';
import { getBotSessionStatus } from '../../../lib/bot-service.js';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');
        const meetingId = searchParams.get('meetingId');

        if (!sessionId && !meetingId) {
            return NextResponse.json({ error: 'sessionId or meetingId required' }, { status: 400 });
        }

        let status;
        if (sessionId) {
            status = await getBotSessionStatus(sessionId);
        } else {
            // Find session by meetingId
            const botServiceUrl = process.env.BOT_SERVICE_URL;
            const res = await fetch(`${botServiceUrl}/status-by-meeting/${meetingId}`);
            if (res.ok) {
                const data = await res.json();
                status = await getBotSessionStatus(data.sessionId);
            } else {
                return NextResponse.json({ status: 'not_found' });
            }
        }

        return NextResponse.json(status);
    } catch (error) {
        console.error('GET /api/bot/status error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
