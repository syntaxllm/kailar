/**
 * Bot Webhook API
 * 
 * Receives events from the external Bot Service
 * 
 * POST /api/bot/webhook
 */

import { NextResponse } from 'next/server';
import { handleBotWebhook } from '../../../../lib/bot-service.js';
import { fetchTranscriptPostMeeting } from '../../../../lib/hybrid-processor.js';

export async function POST(request) {
    try {
        const event = await request.json();

        console.log(`📥 Bot webhook: ${event.type}`);

        if (!event.type || !event.sessionId) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const result = await handleBotWebhook(event);

        // UPDATE UI STATE (InMemory)
        if (!global.activeSessions) global.activeSessions = new Map();

        if (global.activeSessions) {
            const current = global.activeSessions.get(event.sessionId);
            if (current || event.type === 'joined') {
                const newState = current || {
                    id: event.sessionId,
                    meetingId: event.data?.meetingId,
                    startedAt: new Date().toISOString()
                };

                if (event.type === 'joined') newState.status = 'joining';
                if (event.type === 'recording_started') newState.status = 'recording';
                if (event.type === 'meeting_ended' || event.type === 'error') {
                    global.activeSessions.delete(event.sessionId);
                } else {
                    global.activeSessions.set(event.sessionId, newState);
                }
            }
        }

        // When meeting ends, fetch transcript
        if (event.type === 'meeting_ended' || event.type === 'transcript_ready') {
            const { sessionId, data } = event;
            const meetingId = data?.meetingId || sessionId;
            const mode = data?.mode || 'bot_recording';
            const accessToken = data?.accessToken || null;
            const joinUrl = data?.joinUrl || null;

            // Trigger transcript fetch
            const fetchResult = await fetchTranscriptPostMeeting(
                sessionId,
                meetingId,
                mode,
                accessToken,
                joinUrl
            );

            console.log(`📄 Transcript fetch result:`, fetchResult);
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error('Webhook error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
