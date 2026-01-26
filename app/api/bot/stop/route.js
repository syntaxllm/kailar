/**
 * Bot Stop API
 * 
 * POST /api/bot/stop?sessionId=xxx - Stop a recording session
 */

import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');

        if (!sessionId) {
            return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
        }

        // Remove from active sessions
        if (global.activeSessions) {
            global.activeSessions.delete(sessionId);
        }

        // If there's a bot service, try to stop it there too
        const botServiceUrl = process.env.BOT_SERVICE_URL;
        if (botServiceUrl) {
            try {
                await fetch(`${botServiceUrl}/leave/${sessionId}`, { method: 'POST' });
            } catch (e) {
                // Bot service might not be running
            }
        }

        return NextResponse.json({ success: true, message: 'Session stopped' });
    } catch (error) {
        console.error('POST /api/bot/stop error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
