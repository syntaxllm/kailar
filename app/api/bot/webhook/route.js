/**
 * Bot Webhook API
 * 
 * Receives events from the external Bot Service:
 * - Bot joined meeting
 * - Recording started/stopped
 * - Transcript ready
 * 
 * POST /api/bot/webhook
 */

import { NextResponse } from 'next/server';
import { handleBotWebhook } from '../../../../lib/bot-service.js';
import { completeBotSession } from '../../../../lib/hybrid-processor.js';

export async function POST(request) {
    try {
        const event = await request.json();

        console.log(`📥 Bot webhook received: ${event.type}`);

        // Validate webhook (in production, verify signature)
        if (!event.type || !event.sessionId) {
            return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
        }

        // Handle the event
        const result = await handleBotWebhook(event);

        // Special handling for transcript_ready - trigger ingestion
        if (event.type === 'transcript_ready' && event.data?.transcript) {
            const meetingId = event.data.meetingId || event.sessionId;

            // Complete the session and ingest transcript
            const ingestionResult = await completeBotSession(event.sessionId, meetingId);

            if (ingestionResult.success) {
                console.log(`✅ Transcript ingested for meeting: ${meetingId}`);
            } else {
                console.error(`❌ Ingestion failed: ${ingestionResult.error}`);
            }
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error('Bot webhook error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
