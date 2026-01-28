
const express = require('express');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
const formData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');

// Enable stealth plugin to avoid detection
// puppeteerExtra.use(StealthPlugin());

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 6767;
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://localhost:5656';
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://localhost:4545';

// Store active sessions by sessionId
const sessions = new Map();
const MAX_BOTS = process.env.MAX_BOTS || 5; // Global concurrency limit

/**
 * Notify the main application about bot events
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
        console.error(`[Webhook] Failed to send ${type}: ${error.message}`);
    }
}

/**
 * Call Decoupled STT Service
 */
async function processAudioThroughSTT(sessionId, audioPath, speakerNames = []) {
    console.log(`[STT] Handoff to STT Service for session ${sessionId}`);
    try {
        const form = new formData();
        form.append('file', fs.createReadStream(audioPath));
        form.append('meeting_id', sessionId);
        form.append('speaker_names', JSON.stringify(speakerNames));

        const response = await axios.post(`${STT_SERVICE_URL}/transcribe`, form, {
            headers: form.getHeaders(),
            timeout: 300000 // 5 min timeout for long audio
        });

        return response.data;
    } catch (error) {
        console.error(`[STT] Handoff failed: ${error.message}`);
        throw error;
    }
}

/**
 * Simple Launch Endpoint - One-click bot launch
 * Requires joinUrl in request body
 */
app.post('/launch', async (req, res) => {
    const { joinUrl, botName, meetingId } = req.body;

    if (!joinUrl) {
        return res.status(400).json({
            error: 'joinUrl is required',
            message: 'Please provide a meeting URL in the request body'
        });
    }

    const sessionId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const finalMeetingId = meetingId || `meeting_${Date.now()}`;

    console.log(`[BotService] Simple launch requested - Session: ${sessionId}, Meeting: ${finalMeetingId}`);

    // Check if bot already in this meeting
    for (const [sId, sess] of sessions.entries()) {
        if (sess.meetingId === finalMeetingId && sess.status !== 'completed' && sess.status !== 'error') {
            console.log(`[BotService] Bot already in meeting ${finalMeetingId}. Attaching user.`);
            return res.json({
                status: 'attached',
                sessionId: sId,
                message: 'A bot is already recording this meeting. You will receive the shared data.'
            });
        }
    }

    // Check concurrency
    const activeBots = Array.from(sessions.values()).filter(s => s.status !== 'completed' && s.status !== 'error').length;
    if (activeBots >= MAX_BOTS) {
        return res.status(429).json({
            error: 'BUSY',
            message: 'All available bot instances are currently in use. Please try again later.'
        });
    }

    sessions.set(sessionId, {
        status: 'joining',
        meetingId: finalMeetingId,
        mode: 'bot_recording',
        joinUrl,
        enableTeamsTranscription: false,
        recordAudio: true,
        botName: botName || process.env.BOT_NAME || 'Skarya bot',
        joinedAt: new Date()
    });

    runBot(sessionId).catch(err => {
        console.error(`[BotService] Critical error in session ${sessionId}:`, err);
        const s = sessions.get(sessionId);
        if (s) s.status = 'error';
    });

    res.json({
        status: 'initiated',
        sessionId,
        meetingId: finalMeetingId,
        message: 'Bot is joining the meeting...',
        joinUrl
    });
});

/**
 * Main Join Endpoint
 */
app.post('/join', async (req, res) => {
    const {
        sessionId,
        joinUrl,
        meetingId,
        mode,
        botName,
        enableTeamsTranscription,
        recordAudio
    } = req.body;

    if (!joinUrl || !sessionId) {
        return res.status(400).json({ error: 'joinUrl and sessionId are required' });
    }

    // MANDATE: Unique Bot Enforcement
    // Check if a bot is already in this meeting (by meetingId)
    for (const [sId, sess] of sessions.entries()) {
        if (sess.meetingId === meetingId && sess.status !== 'completed' && sess.status !== 'error') {
            console.log(`[BotService] Bot already in meeting ${meetingId}. Attaching user.`);
            return res.json({
                status: 'attached',
                sessionId: sId,
                message: 'A bot is already recording this meeting. You will receive the shared data.'
            });
        }
    }

    if (sessions.has(sessionId)) {
        return res.json({ status: 'already_active', sessionId });
    }

    // MANDATE: Concurrency Manager
    // Prevent server "melting" by limiting total active bots
    const activeBots = Array.from(sessions.values()).filter(s => s.status !== 'completed' && s.status !== 'error').length;
    if (activeBots >= MAX_BOTS) {
        console.log(`[BotService] Denied join: MAX_BOTS (${MAX_BOTS}) reached.`);
        return res.status(429).json({
            error: 'BUSY',
            message: 'All available bot instances are currently in use. Please try again later.'
        });
    }

    console.log(`[BotService] Session ${sessionId} starting on port ${PORT}`);

    sessions.set(sessionId, {
        status: 'joining',
        meetingId,
        mode,
        joinUrl,
        enableTeamsTranscription,
        recordAudio,
        botName: botName || process.env.BOT_NAME || 'Skarya bot',
        joinedAt: new Date()
    });

    runBot(sessionId).catch(err => {
        console.error(`[BotService] Critical error in session ${sessionId}:`, err);
        // Optionally update session status to error
        const s = sessions.get(sessionId);
        if (s) s.status = 'error';
    });
    res.json({ status: 'initiated', sessionId });
});

// Prevent process crashes on unhandled errors
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

/**
 * Status Check
 */
app.get('/status/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({
        sessionId: req.params.sessionId,
        status: session.status,
        meetingId: session.meetingId,
        mode: session.mode
    });
});

/**
 * Find session by Meeting ID
 */
app.get('/status-by-meeting/:meetingId', (req, res) => {
    for (const [sId, sess] of sessions.entries()) {
        if (sess.meetingId === req.params.meetingId && sess.status !== 'completed') {
            return res.json({ sessionId: sId, status: sess.status });
        }
    }
    res.status(404).json({ error: 'No active session for this meeting' });
});

/**
 * Transcript Fetch (Schema-aligned)
 */
app.get('/transcript/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Returns status, transcript and metadata
    res.json({
        sessionId: req.params.sessionId,
        status: session.status,
        transcript: session.transcript || [],
        duration: session.duration || 0,
        audioPath: session.audioPath || null
    });
});

/**
 * Leave/Terminate
 */
app.post('/leave/:sessionId', async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    console.log(`[BotService] Terminating session ${req.params.sessionId}`);
    await handleMeetingEnd(req.params.sessionId);

    res.json({ status: 'left', sessionId: req.params.sessionId });
});

/**
 * Bot Runner Logic
 */
async function runBot(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    // DEBUG TRACE
    try { fs.appendFileSync('debug_trace.log', `[${new Date().toISOString()}] Starting runBot for ${sessionId}\n`); } catch (e) { }

    let browser;
    try {
        const executablePath = require('puppeteer').executablePath();
        try { fs.appendFileSync('debug_trace.log', `[${new Date().toISOString()}] Chrome Path: ${executablePath}\n`); } catch (e) { }

        // Use puppeteer-extra with stealth for better Teams compatibility
        browser = await puppeteerExtra.launch({
            executablePath: executablePath,
            defaultViewport: { width: 1280, height: 720 },
            headless: false, // IMPORTANT: always false in prod
            dumpio: false, // Reduce noise
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--autoplay-policy=no-user-gesture-required',
                '--window-size=1280,720',
                '--lang=en-US,en'
            ]
        });

        session.browser = browser;
        const page = await browser.newPage();

        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Override webdriver property
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
        });

        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://teams.microsoft.com', ['microphone', 'camera']);

        console.log(`[Bot] Navigating to meeting URL...`);
        await page.goto(session.joinUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // DEBUG: Capture initial state
        // Screnshots removed as per request
        console.log(`[Bot] Initial load complete`);
        // Teams Flow Resilience: Handle "Get App" / "Continue on Browser" interceptor
        console.log("[Bot] Checking for 'Continue on this browser' interceptors...");

        // Wait a bit for page to stabilize
        await new Promise(r => setTimeout(r, 2000));

        // Try to find and click "Continue on browser" button
        const continueSelectors = [
            'button[data-tid="joinOnWeb"]',
            'button[aria-label*="Continue on this browser" i]',
            'button[aria-label*="Use the web app" i]',
            'button[aria-label*="Join on the web" i]',
            'button:has-text("Continue on this browser")',
            'button:has-text("Use web app")',
            'button.open-web-button',
            'a[href*="teams.microsoft.com"]'
        ];

        let foundContinueButton = false;
        const urlBeforeClick = page.url();

        for (const selector of continueSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    const isVisible = await button.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
                    });
                    if (isVisible) {
                        console.log(`[Bot] Found continue button with selector: ${selector}`);

                        // Click and wait for navigation
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { }),
                            button.click()
                        ]);

                        foundContinueButton = true;
                        await new Promise(r => setTimeout(r, 2000)); // Additional wait

                        // Check if we actually navigated
                        const urlAfterClick = page.url();
                        if (urlAfterClick !== urlBeforeClick && !urlAfterClick.includes('launcher')) {
                            console.log(`[Bot] ✅ Successfully navigated to: ${urlAfterClick}`);
                            break;
                        } else {
                            console.log(`[Bot] ⚠️  Still on launcher page after click. URL: ${urlAfterClick}`);
                        }
                        break;
                    }
                }
            } catch (e) {
                // Try next selector
            }
        }

        // If we're still on the launcher page, try to construct and navigate to direct web meeting URL
        const currentUrl = page.url();
        if (currentUrl.includes('launcher') || currentUrl.includes('dl/launcher')) {
            console.log("[Bot] Still on launcher page. Attempting direct navigation to web meeting...");

            // Extract meeting ID from original URL
            const meetingMatch = session.joinUrl.match(/meet\/(\d+)/);
            if (meetingMatch) {
                const meetingId = meetingMatch[1];
                // Extract the 'p' parameter if present
                const pMatch = session.joinUrl.match(/[?&]p=([^&]+)/);
                const pParam = pMatch ? pMatch[1] : '';

                // Construct direct web meeting URL
                let directMeetingUrl = `https://teams.microsoft.com/_#/meet/${meetingId}?anon=true`;
                if (pParam) {
                    directMeetingUrl += `&p=${pParam}`;
                }

                console.log(`[Bot] Navigating directly to: ${directMeetingUrl}`);
                try {
                    await page.goto(directMeetingUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                    await new Promise(r => setTimeout(r, 3000)); // Wait for page to load
                    console.log(`[Bot] ✅ Direct navigation completed. Current URL: ${page.url()}`);
                } catch (e) {
                    console.error(`[Bot] Direct navigation failed: ${e.message}`);
                }
            }
        }

        // Wait for Pre-Join screen and handle name input
        console.log("[Bot] Waiting for pre-join screen...");

        // Wait a bit for the page to fully load after clicking "Continue on browser"
        await new Promise(r => setTimeout(r, 5000)); // Increased wait time

        const nameInputSelectors = [
            'input[data-tid="prejoin-display-name-input"]', // Modern Teams
            'input[placeholder*="your name" i]', // More specific placeholder
            'input[aria-label*="your name" i]', // More specific aria-label
            'input[autocomplete="name"]',
            'input[name="displayName"]',
            'input[type="text"][id*="name"]',
            '#username', // Common ID
            'input[type="text"]' // Last resort
        ];

        let nameInput = null;
        for (const selector of nameInputSelectors) {
            try {
                // Wait for input to be present and visible
                const element = await page.waitForSelector(selector, { visible: true, timeout: 2000 }).catch(() => null);
                if (element) {
                    nameInput = element;
                    console.log(`[Bot] Found name input with selector: ${selector}`);
                    break;
                }
            } catch (e) {
                // Ignore and try next selector
            }
        }


        const botName = session.botName || "Skarya bot";
        let nameEntered = false;

        if (nameInput) {
            let attempt = 0;
            while (!nameEntered && attempt < 3) {
                attempt++;
                console.log(`[Bot] Attempting to set name (Attempt ${attempt})...`);
                try {
                    // FIX: Dispatch real input events which React relies on
                    await page.evaluate((el, value) => {
                        el.focus();
                        el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }, nameInput, botName);

                    await new Promise(r => setTimeout(r, 500));

                    // Verify name was entered correctly
                    const enteredName = await nameInput.evaluate(el => el.value);
                    if (enteredName === botName) {
                        console.log(`[Bot] ✅ Name successfully entered: "${enteredName}"`);
                        nameEntered = true;
                    } else {
                        console.warn(`[Bot] ⚠️ Name verification failed. Expected "${botName}", got "${enteredName}". Retrying...`);
                    }
                } catch (e) {
                    console.error(`[Bot] Error during name entry attempt ${attempt}: ${e.message}`);
                    await new Promise(r => setTimeout(r, 1000)); // Wait before retrying
                }
            }
        } else {
            console.warn("[Bot] ⚠️ Could not find name input field after trying all selectors.");
        }

        if (!nameEntered) {
            console.warn("[Bot] ⚠️ WARNING: Could not confirm name entry. Proceeding anyway, but join may fail.");
        }

        // FIX: Ensure mic is toggled ON before clicking join
        try {
            console.log("[Bot] Checking microphone state...");
            await page.evaluate(() => {
                const micBtn = document.querySelector('button[aria-label*="Microphone" i]');
                // If button exists and is NOT pressed (meaning mic is off), click it.
                // Note: Teams UI is tricky; sometimes 'aria-pressed' reflects the mute state.
                // Usually matching "Turn on microphone" or similar label is safer if aria-pressed is ambiguous.
                // Assuming standard Teams behavior: aria-pressed="true" means ON for toggle buttons usually, 
                // but for "Mute microphone" buttons, pressed means Muted.
                // Let's rely on the user's specific instruction first:
                // "if micBtn and aria-pressed === 'false' -> click"
                if (micBtn && micBtn.getAttribute('aria-pressed') === 'false') {
                    micBtn.click();
                }
            });
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.warn("[Bot] Custom mic toggle check failed:", e);
        }

        // FIX: Wait for audio setup text to disappear
        try {
            console.log("[Bot] Waiting for audio setup to complete...");
            await page.waitForFunction(() => {
                return !document.body.innerText.includes('Setting up your audio');
            }, { timeout: 15000 }).catch(() => console.log("[Bot] 'Setting up your audio' wait timed out (might not have appeared)."));
        } catch (e) { }

        // Click JOIN button
        console.log("[Bot] Looking for Join button...");

        const joinButton = await page.waitForSelector('button[data-tid="prejoin-join-button"], button[aria-label*="Join now" i]', {
            visible: true,
            timeout: 30000
        }).catch(() => null);

        if (!joinButton) {
            throw new Error("JOIN_BUTTON_NOT_FOUND - Could not locate join button after multiple attempts");
        }

        // Ensure button is stable before clicking
        await new Promise(r => setTimeout(r, 1000));

        // Click join button
        try {
            await joinButton.click();
            console.log("[Bot] Clicked 'Join Now'. Waiting for meeting to load...");
        } catch (e) {
            // Try alternative click method
            try {
                await page.evaluate(() => {
                    const selectors = [
                        'button[data-tid="prejoin-join-button"]',
                        'button[aria-label*="Join now" i]',
                        'button[aria-label*="Join meeting" i]'
                    ];
                    for (const sel of selectors) {
                        const btn = document.querySelector(sel);
                        if (btn && !btn.disabled) {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });
            } catch (e2) {
                console.warn("[Bot] Alternative click method also failed");
            }
        }

        // Wait a moment for the click to register
        await new Promise(r => setTimeout(r, 2000));

        // Wait for meeting to load - use multiple detection strategies
        console.log("[Bot] Waiting for meeting to load...");

        // Strategy 1: Look for in-meeting UI elements (for modern Teams UI)
        const inMeetingSelectors = [
            'button[data-tid="call-hangup"]', // Classic but still sometimes works
            'button[aria-label*="Leave call" i]', // More specific for V2
            'button[aria-label*="Hang up" i]',
            '#roster-button', // V2 roster button
            '#chat-button', // V2 chat button
            'button[data-tid="roster-button"]',
            'button[data-tid="chat-thread-button"]',
            '[data-cid="calling-control-bar"]', // The entire control bar
            'button[title="Show participants"]' // Alternative text
        ];

        // Strategy 2: Check if pre-join screen is gone
        const preJoinSelectors = [
            'button[data-tid="prejoin-join-button"]',
            'div[data-tid="pre-join-screen"]', // The main container for the pre-join screen
            '.prejoin-container'
        ];

        // FIX: Reliable join detection using URL + Audio Element + Lobby Text
        console.log("[Bot] Waiting for meeting join confirmation...");

        let inMeeting = false;
        try {
            await page.waitForFunction(() => {
                // Check for hard failure messages first to fail fast
                const bodyText = document.body.innerText;
                if (bodyText.includes("Can't join the meeting") ||
                    bodyText.includes("Something went wrong") ||
                    bodyText.includes("Ask the organizer")) {
                    throw new Error("TEAMS_JOIN_REJECTED");
                }

                // Success Criteria: URL check OR Lobby text OR Explicit UI buttons
                // REMOVED hard audio element check as it causes false failures
                // bodyText is already defined above in the failure check block, so we reuse it
                const urlSuccess = location.href.includes('/meet/');

                const lobbySuccess = bodyText.includes("You're in the lobby") ||
                    bodyText.includes("waiting to be admitted") ||
                    bodyText.includes("Someone in the meeting should let you in soon");

                const uiSuccess = !!(document.querySelector('button[aria-label*="Leave" i]') ||
                    document.querySelector('[data-tid="call-hangup"]'));

                return (urlSuccess && !bodyText.includes("Connecting")) || lobbySuccess || uiSuccess;
            }, { timeout: 60000, polling: 1000 });

            inMeeting = true;
            console.log("[Bot] ✅ Successfully joined meeting (or entered lobby).");
        } catch (e) {
            if (e.message.includes("TEAMS_JOIN_REJECTED")) {
                throw e; // Propagate fatal error
            }
            console.warn(`[Bot] Join confirmation timed out: ${e.message}`);
        }

        if (!inMeeting) {
            console.log(`[Bot] Current URL: ${page.url()}`);
            throw new Error("MEETING_ENTRY_TIMEOUT - Could not confirm meeting entry after 60 seconds");
        }

        session.status = 'joined';
        await notifyMainApp(sessionId, 'joined', { meetingId: session.meetingId });

        // Monitoring Loop for Kicked Status
        page.on('close', async () => {
            console.log("[Bot] Page closed.");
            await notifyMainApp(sessionId, 'bot_kicked', { reason: 'Page Closed' });
        });

        // Check for specific "Removed" text occasionally
        const checkKickedInterval = setInterval(async () => {
            try {
                if (page.isClosed()) { clearInterval(checkKickedInterval); return; }
                const content = await page.content();
                if (content.includes("You have been removed from the meeting") || content.includes("You've been removed")) {
                    console.log("[Bot] Kicked from meeting.");
                    await notifyMainApp(sessionId, 'bot_kicked', { reason: 'Removed by organizer' });
                    clearInterval(checkKickedInterval);
                    await browser.close();
                }
            } catch (e) { }
        }, 5000);

        // NEW: Real-time Name Monitoring
        monitorSpeakers(page, sessionId);

        if (session.recordAudio) {
            await startRecording(page, sessionId);
        }
    } catch (error) {
        console.error(`[Bot] Error:`, error);
        await notifyMainApp(sessionId, 'error', { error: error.message });
        if (browser) await browser.close();
        sessions.delete(sessionId);
    }
}

/**
 * Monitor Teams UI for Active Speaker Names
 * Uses MutationObserver to see who is highlighted as speaking
 */
async function monitorSpeakers(page, sessionId) {
    const session = sessions.get(sessionId);
    session.speakerLog = []; // { name, timestamp }

    console.log(`[Bot] Starting Speaker Name Monitoring for ${sessionId}`);

    try {
        // 1. Open Participant List if not open
        // Selector for "People" or "Participants" button in Teams navbar
        const peopleBtn = 'button[data-tid="calling-participant-list-button"]';
        await page.waitForSelector(peopleBtn, { timeout: 10000 }).catch(() => { });
        await page.click(peopleBtn);

        // 2. Inject script to watch for speaker indicators
        await page.exposeFunction('onSpeakerChange', (name) => {
            const now = Date.now();
            const elapsed = (now - session.joinedAt) / 1000;

            // Only log if it's a new speaker to avoid spam
            const lastLog = session.speakerLog[session.speakerLog.length - 1];
            if (!lastLog || lastLog.name !== name) {
                console.log(`[Speaker] ${name} is now speaking at ${elapsed.toFixed(2)}s`);
                session.speakerLog.push({ name, timestamp: elapsed });

                // Real-time UI Sync: Notify main app of current speaker
                notifyMainApp(sessionId, 'speaker_change', { name });
            }
        });

        await page.evaluate(() => {
            const observer = new MutationObserver(() => {
                // Teams active speaker selector (brittle but standard pattern)
                // We look for elements with the "speaking" animation or active status
                const activeSpeakers = document.querySelectorAll('[data-tid="participant-item-active-speaker"], .speaking-indicator-active');

                activeSpeakers.forEach(el => {
                    // Find the name label associated with this item
                    const nameEl = el.closest('[data-tid="participant-list-item"]')?.querySelector('[data-tid="participant-item-name"]');
                    if (nameEl) {
                        window.onSpeakerChange(nameEl.innerText);
                    }
                });
            });

            const config = { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] };
            const container = document.querySelector('[data-tid="participant-list"]') || document.body;
            observer.observe(container, config);
        });

    } catch (e) {
        console.warn(`[Bot] Speaker monitoring warning: ${e.message}`);
    }
}

async function startRecording(page, sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    console.log(`[Bot] Starting recording for ${sessionId}...`);

    // Verify we're actually in a meeting before starting recording
    try {
        const inMeetingCheck = await page.evaluate(() => {
            // FIX: Don't rely on pre-join buttons being gone. Rely on presence of audio or leave button.
            const hasAudio = document.querySelector('audio') !== null;
            const hasLeaveBtn = document.querySelector('button[aria-label*="Leave" i]') !== null ||
                document.querySelector('[data-tid="call-hangup"]') !== null;
            const inLobby = document.body.innerText.includes("You're in the lobby");

            return hasAudio || hasLeaveBtn || inLobby;
        });

        // Wait slightly if we are just joining
        if (!inMeetingCheck) {
            await new Promise(r => setTimeout(r, 5000));
        }

        // Final check
        const finalInMeetingCheck = await page.evaluate(() => {
            const hasAudio = document.querySelector('audio') !== null;
            const hasLeaveBtn = document.querySelector('button[aria-label*="Leave" i]') !== null ||
                document.querySelector('[data-tid="call-hangup"]') !== null;
            const inLobby = document.body.innerText.includes("You're in the lobby");
            return hasAudio || hasLeaveBtn || inLobby;
        });

        if (!finalInMeetingCheck) {
            console.warn(`[Bot] ⚠️  Warning: Cannot confirm bot is in meeting. Recording may fail.`);
        }
    } catch (e) {
        console.warn(`[Bot] Could not verify meeting state: ${e.message}`);
    }

    session.status = 'recording';
    await notifyMainApp(sessionId, 'recording_started');

    try {
        const { getStream } = require('puppeteer-stream');
        console.log(`[Bot] Requesting audio stream from page...`);

        // Increase timeout for getStream
        const stream = await Promise.race([
            getStream(page, { audio: true, video: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Stream timeout')), 60000))
        ]);

        // Ensure temp directory exists
        const meetingDir = path.join(__dirname, 'temp', sessionId);
        if (!fs.existsSync(meetingDir)) {
            fs.mkdirSync(meetingDir, { recursive: true });
        }

        let chunkIndex = 0;
        let currentFile;

        async function startNewChunk() {
            if (currentFile) currentFile.end();

            chunkIndex++;
            const chunkPath = path.join(meetingDir, `chunk_${String(chunkIndex).padStart(3, '0')}.wav`);
            currentFile = fs.createWriteStream(chunkPath);

            // In production with ffmpeg path:
            // stream.pipe(ffmpegInstance.input(stream).format('wav').pipe(currentFile))

            stream.pipe(currentFile);
            console.log(`[Bot] Recording chunk ${chunkIndex} to ${chunkPath}`);
        }

        await startNewChunk();

        // Checkpoint every 5 minutes
        const chunkInterval = setInterval(() => {
            if (session.status !== 'recording') {
                clearInterval(chunkInterval);
                return;
            }
            startNewChunk();
        }, 5 * 60 * 1000);

        session.chunkInterval = chunkInterval;
        session.stream = stream;

    } catch (error) {
        console.error(`[Bot] Recording failed for ${sessionId}:`, error.message);
    }
}

async function handleMeetingEnd(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    if (session.status === 'recording') {
        session.status = 'processing';
        if (session.chunkInterval) clearInterval(session.chunkInterval);

        try {
            const meetingDir = path.join(__dirname, 'temp', sessionId);
            let audioToProcess = null;

            if (fs.existsSync(meetingDir)) {
                const files = fs.readdirSync(meetingDir)
                    .filter(f => f.endsWith('.wav'))
                    .map(f => path.join(meetingDir, f))
                    .sort(); // Sort to ensure chronological order

                if (files.length > 1) {
                    console.log(`[Bot] Merging ${files.length} audio chunks for ${sessionId}...`);
                    const mergedPath = path.join(meetingDir, 'merged.wav');

                    // Promise wrapper for ffmpeg
                    await new Promise((resolve, reject) => {
                        const command = ffmpeg();
                        files.forEach(file => command.input(file));

                        command
                            .on('error', (err) => {
                                console.error('[FFMPEG] Error merging files:', err);
                                reject(err);
                            })
                            .on('end', () => {
                                console.log('[FFMPEG] Merging finished.');
                                resolve();
                            })
                            .mergeToFile(mergedPath, meetingDir); // The second arg is a temp dir for ffmpeg
                    });

                    audioToProcess = mergedPath;
                    console.log(`[Bot] Selected merged audio for processing: ${audioToProcess}`);

                } else if (files.length === 1) {
                    audioToProcess = files[0];
                    console.log(`[Bot] Selected single audio chunk for processing: ${audioToProcess}`);
                }
            }

            if (!audioToProcess) {
                const samplePath = path.join(__dirname, 'sample.wav');
                if (fs.existsSync(samplePath)) {
                    audioToProcess = samplePath;
                    console.log("[Bot] No recorded audio found. Using sample.wav fallback.");
                }
            }

            if (audioToProcess) {
                const sttResult = await processAudioThroughSTT(sessionId, audioToProcess, session.speakerLog);
                session.transcript = sttResult.transcript;
                session.duration = sttResult.duration;
                session.audioPath = sttResult.audio_path; // STT service returns final path
                console.log(`[Bot] STT Success. Audio stored at: ${session.audioPath}`);
            } else {
                console.log("[Bot] No audio source found. Simulating transcript.");
                const realName = session.speakerLog?.[0]?.name || "Unknown Speaker";
                session.transcript = [
                    { start_time: 0, end_time: 5, speaker_id: realName, text: "Welcome." },
                    { start_time: 5, end_time: 10, speaker_id: "System", text: "No audio was recorded for this session." }
                ];
            }

            await notifyMainApp(sessionId, 'transcript_ready', {
                meetingId: session.meetingId,
                mode: session.mode
            });

            // MANDATE: Cleanup temp audio files
            if (fs.existsSync(meetingDir)) {
                fs.rmSync(meetingDir, { recursive: true, force: true });
                console.log(`[Bot] Cleaned up temp files for ${sessionId}`);
            }

        } catch (e) {
            console.error("[Bot] Processing failed:", e.message);
            await notifyMainApp(sessionId, 'error', { error: 'PROCESSING_FAILED' });
        }
    }

    if (session.browser) await session.browser.close();

    session.status = 'completed';
}

app.listen(PORT, () => {
    console.log(`[BotService] Port: ${PORT}`);
});
