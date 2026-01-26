/**
 * Bot Status API
 * 
 * GET /api/bot/status - Returns all active sessions (no params)
 * GET /api/bot/status?sessionId=xxx - Returns specific session status
 * POST /api/bot/status - Register a new session
 * DELETE /api/bot/status?sessionId=xxx - Remove a session
 */

import { NextResponse } from 'next/server';

// In-memory session store (in production, use Redis or database)
// Note: This will reset on server restart - in production use persistent storage
const activeSessions = global.activeSessions || new Map();
global.activeSessions = activeSessions;

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');
        const meetingId = searchParams.get('meetingId');

        // If no params, return all active sessions
        if (!sessionId && !meetingId) {
            const sessions = Array.from(activeSessions.values());
            return NextResponse.json({ sessions });
        }

        // Get specific session
        let status = null;
        if (sessionId) {
            status = activeSessions.get(sessionId);
        } else if (meetingId) {
            status = Array.from(activeSessions.values()).find(s => s.meetingId === meetingId);
        }

        if (!status) {
            return NextResponse.json({ status: 'not_found' });
        }

        return NextResponse.json(status);
    } catch (error) {
        console.error('GET /api/bot/status error:', error);
        return NextResponse.json({ sessions: [] });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { sessionId, meetingId, title, url, status } = body;

        if (!sessionId) {
            return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
        }

        activeSessions.set(sessionId, {
            id: sessionId,
            meetingId,
            title: title || meetingId,
            url,
            status: status || 'joining',
            startedAt: new Date().toISOString()
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('POST /api/bot/status error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');

        if (sessionId) {
            activeSessions.delete(sessionId);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('DELETE /api/bot/status error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
