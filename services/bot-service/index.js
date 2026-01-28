const express = require('express');
const { CallAutomationClient } = require('@azure/communication-call-automation');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');

dotenv.config();

const app = express();
app.use(cors());

// Parse JSON and CloudEvents + JSON
app.use(express.json());
app.use(express.json({ type: 'application/cloudevents+json' }));

const PORT = process.env.PORT || 6767;
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://localhost:5656';
const CALLBACK_URI = process.env.CALLBACK_URI; // MUST be public (ngrok or Azure Host)
const ACS_CONNECTION_STRING = process.env.ACS_CONNECTION_STRING;

// Store active calls
// Map<CallConnectionId, { sessionId, meetingId, status, ... }>
const activeCalls = new Map();

// Initialize ACS Client
let acsClient;
try {
    if (ACS_CONNECTION_STRING) {
        acsClient = new CallAutomationClient(ACS_CONNECTION_STRING);
        console.log("[ACS] Client initialized successfully.");
    } else {
        console.warn("[ACS] WARNING: ACS_CONNECTION_STRING is missing in .env. Bot will fail to join.");
    }
} catch (e) {
    console.error("[ACS] Failed to initialize client:", e.message);
}

/**
 * Notify the main application about bot events
 * Maps ACS events to the App's expected webhook format
 */
async function notifyMainApp(sessionId, type, data = {}) {
    try {
        await axios.post(`${MAIN_APP_URL}/api/bot/webhook`, {
            type,
            sessionId,
            data
        });
        console.log(`[Webhook] Sent ${type} for session ${sessionId}`);
    } catch (error) {
        console.warn(`[Webhook] Failed to send ${type}: ${error.message}`);
    }
}

/**
 * LAUNCH / JOIN ENDPOINT
 * This replaces the old Puppeteer launch
 */
app.post(['/launch', '/join'], async (req, res) => {
    const { joinUrl, meetingId, botName } = req.body;

    if (!acsClient) {
        return res.status(500).json({ error: "ACS_NOT_CONFIGURED", message: "Azure credentials missing" });
    }
    if (!CALLBACK_URI) {
        return res.status(500).json({ error: "CALLBACK_URI_MISSING", message: "Need public callback URI (ngrok) in .env" });
    }
    if (!joinUrl) {
        return res.status(400).json({ error: "MISSING_URL", message: "joinUrl is required" });
    }

    const sessionId = `acs_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const finalMeetingId = meetingId || `meet_${Date.now()}`;

    console.log(`[ACS] Launching bot for session ${sessionId}`);
    console.log(`[ACS] Target Meeting: ${joinUrl.substring(0, 50)}...`);

    try {
        // Create the call to the Teams meeting
        const callOptions = {
            microsoftTeamsMeetingLinkLocator: { meetingLink: joinUrl },
            callbackUrl: `${CALLBACK_URI}?sessionId=${sessionId}`, // Embed sessionId in callback to track it
            displayName: botName || process.env.BOT_NAME || "AI Assistant"
        };

        // We pass empty targets array implies "join this meeting locator"
        const callResult = await acsClient.createCall([], callOptions);

        const callConnectionId = callResult.callConnectionProperties.callConnectionId;
        console.log(`[ACS] Call Initiated. ID: ${callConnectionId}`);

        // Store initial state
        activeCalls.set(callConnectionId, {
            sessionId,
            meetingId: finalMeetingId,
            status: 'initiating',
            joinUrl,
            connectionId: callConnectionId
        });

        // Also map sessionId back to connectionId for lookup if needed? 
        // For simplicity, we loop/filter activeCalls when finding by SessionID.

        res.json({
            status: 'initiated',
            sessionId,
            message: 'Bot is joining via Microsoft Graph/ACS...',
            platform: 'azure_acs'
        });

    } catch (error) {
        console.error("[ACS] Join Failed:", error);
        res.status(500).json({
            error: "JOIN_FAILED",
            details: error.message
        });
    }
});

/**
 * ACS CALLBACK HANDLER
 * Receives CloudEvents from Azure
 */
app.post('/api/callbacks', async (req, res) => {
    // Process CloudEvents
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const sessionId = req.query.sessionId; // Retrieved from query param we set earlier

    for (const event of events) {
        console.log(`[ACS Event] Type: ${event.type} | CallId: ${event.data.callConnectionId}`);

        const callId = event.data.callConnectionId;
        const callData = activeCalls.get(callId);

        if (!callData && sessionId) {
            // Reconstruct if missing (rare, but good for statelessness)
            // activeCalls.set(callId, { sessionId, status: 'unknown' });
        }

        if (event.type === 'Microsoft.Communication.CallConnected') {
            console.log(`[ACS] ✅ Connected to meeting for session ${sessionId}`);
            if (callData) callData.status = 'joined';

            await notifyMainApp(sessionId, 'joined', {
                meetingId: callData?.meetingId,
                platform: 'azure_acs'
            });

            // Phase 2: Here we would trigger audio recording logic
            // await startRecording(callId);

        } else if (event.type === 'Microsoft.Communication.CallDisconnected') {
            console.log(`[ACS] ❌ Disconnected from meeting.`);
            if (callData) callData.status = 'completed';

            await notifyMainApp(sessionId, 'bot_kicked', { reason: 'Call Disconnected' });
            activeCalls.delete(callId);
        }
    }

    res.sendStatus(200);
});

/**
 * STATUS
 */
app.get('/status/:sessionId', (req, res) => {
    // Find call by sessionId
    const callEntry = Array.from(activeCalls.values()).find(c => c.sessionId === req.params.sessionId);

    if (!callEntry) {
        return res.status(404).json({ error: 'Session not found or ended' });
    }

    res.json({
        sessionId: callEntry.sessionId,
        status: callEntry.status,
        meetingId: callEntry.meetingId,
        backend: 'acs'
    });
});

/**
 * LEAVE
 */
app.post('/leave/:sessionId', async (req, res) => {
    const callEntry = Array.from(activeCalls.values()).find(c => c.sessionId === req.params.sessionId);
    if (!callEntry) return res.status(404).json({ error: 'Session not found' });

    try {
        const callConnection = acsClient.getCallConnection(callEntry.connectionId);
        await callConnection.hangUp(true); // true = for everyone? No, usually false for bot.
        res.json({ status: 'hanging_up' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[BotService] ACS Bot listening on port ${PORT}`);
    console.log(`[BotService] Callback URI configured: ${CALLBACK_URI || 'NOT SET'}`);
});
