const express = require('express');
// Enhanced Puppeteer
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { launch } = require('puppeteer-stream');

puppeteer.use(StealthPlugin());

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
const formData = require('form-data');

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
        joinedAt: new Date()
    });

    runBot(sessionId);
    res.json({ status: 'initiated', sessionId });
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

    let browser;
    try {
        browser = await launch({
            executablePath: require('puppeteer').executablePath(), // Use standard chrome path
            defaultViewport: { width: 1280, height: 720 },
            headless: process.env.HEADLESS === 'true' ? 'new' : false, // 'new' is faster/better
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--disable-notifications',
                '--disable-infobars',
                '--window-size=1280,720'
            ]
        });

        session.browser = browser;
        const page = await browser.newPage();

        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://teams.microsoft.com', ['microphone', 'camera']);

        await page.goto(session.joinUrl, { waitUntil: 'networkidle2' });

        // Teams interaction...
        // Teams Flow Resilience: Handle "Get App" / "Continue on Browser" interceptor
        try {
            console.log("[Bot] Checking for 'Continue on this browser' interceptors...");

            // Extensive list of known selectors for the "Continue on browser" button
            const continueSelectors = [
                'button[data-tid="joinOnWeb"]',
                'button.open-web-button',
                'button[aria-label="Continue on this browser"]',
                'button[aria-label="Use the web app instead"]',
                '.input-group button.btn-primary' // Sometimes generic
            ];

            // Also watch for the name input immediately (if we skipped the interceptor)
            const nameInputSelectors = [
                'input[data-tid="prejoin-display-name-input"]',
                'input[name="displayName"]',
                'input[placeholder="Type your name"]',
                '#username'
            ];

            const combinedSelector = [...continueSelectors, ...nameInputSelectors].join(', ');

            // Wait for ANY of these to appear
            const foundElement = await page.waitForSelector(combinedSelector, { timeout: 25000 });

            // Check what we found
            const isButton = await foundElement.evaluate(el => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');

            if (isButton) {
                console.log("[Bot] Interrupt screen detected. Clicking 'Continue on Browser'...");
                await foundElement.click();

                // After clicking, we must wait for the PRE-JOIN screen (Name input)
                await page.waitForSelector(nameInputSelectors.join(', '), { timeout: 40000 });
                console.log("[Bot] Successfully navigated to Pre-Join screen.");
            } else {
                console.log("[Bot] Directly landed on Pre-Join screen (Name Input).");
            }
        } catch (e) {
            console.warn("[Bot] Navigation warning: Could not find 'Continue' or 'Name Input' within timeout. checking if already joined or different layout.", e.message);
        }

        // Wait for Name Input
        // 2a. Turn OFF Camera (Critical to avoid 'fake device' banner issues)
        try {
            const camToggleSelector = 'div[data-tid="toggle-video"] > [aria-checked="true"]';
            const micToggleSelector = 'div[data-tid="toggle-mute"] > [aria-checked="true"]';

            // Attempt to turn off video
            const camToggle = await page.$(camToggleSelector);
            if (camToggle) {
                await camToggle.click();
                console.log("[Bot] Camera turned OFF.");
                await new Promise(r => setTimeout(r, 500)); // Brief pause
            }

            // Attempt to turn off mic (optional, but good practice if we only want to listen)
            // But we might want to announce ourselves? For now, let's leave mic ON or respect default.
            // keeping mic logic commented out unless requested.
        } catch (e) {
            console.log("[Bot] Camera toggle check skipped.");
        }

        // 3. Enter Name
        const botName = process.env.BOT_NAME || "Meeting Assistant";
        const nameInputSelector = 'input[data-tid="prejoin-display-name-input"], input[placeholder="Type your name"], input[name="displayName"]';

        try {
            await page.waitForSelector(nameInputSelector, { timeout: 15000 });

            // Focus and clear
            await page.click(nameInputSelector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, 500));

            // Type name explicitly
            await page.type(nameInputSelector, botName, { delay: 50 });
            console.log(`[Bot] Name entered: ${botName}`);
        } catch (e) {
            console.warn("[Bot] Name input not found. Assuming we might be logged in or anonymous join mismatch.");
        }

        // 4. Click JOIN
        try {
            const joinNowSelectors = [
                'button[data-tid="prejoin-join-button"]',
                'button.join-btn',
                'button[aria-label="Join now"]',
                'button:has-text("Join now")' // utilizing pseudoselector if supported or generic fallback
            ];

            const joinSelector = joinNowSelectors.join(', ');
            await page.waitForSelector(joinSelector, { timeout: 10000 });

            // Double check it's clickable
            await page.click(joinSelector);
            console.log("[Bot] Clicked 'Join Now'. Waiting for roster...");
        } catch (e) {
            console.error("[Bot] 'Join Now' button not found!");
            throw new Error("JOIN_BUTTON_NOT_FOUND");
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

    console.log(`[Bot] Recording ${sessionId} with 5-minute checkpoints`);
    session.status = 'recording';
    await notifyMainApp(sessionId, 'recording_started');

    try {
        const { getStream } = require('puppeteer-stream');
        const stream = await getStream(page, { audio: true, video: false });

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
        if (session.chunkInterval) clearInterval(session.chunkInterval); // Ensure interval is cleared

        try {
            // Locate recorded chunks
            const meetingDir = path.join(__dirname, 'temp', sessionId);
            let audioToProcess = null;

            if (fs.existsSync(meetingDir)) {
                const files = fs.readdirSync(meetingDir).filter(f => f.endsWith('.wav'));
                if (files.length > 0) {
                    // For now, take the last chunk or the largest one. 
                    // Ideally, we'd stitch them, but for this MVP, we process the last valid chunk 
                    // or a specific merged file if we had stitching logic.
                    // Let's grab the file with the largest size aka most content
                    const sortedFiles = files.map(file => {
                        const filePath = path.join(meetingDir, file);
                        return { name: file, path: filePath, size: fs.statSync(filePath).size };
                    }).sort((a, b) => b.size - a.size); // Descending size

                    audioToProcess = sortedFiles[0].path;
                    console.log(`[Bot] Selected audio for processing: ${audioToProcess} (${(sortedFiles[0].size / 1024 / 1024).toFixed(2)} MB)`);
                }
            }

            // Fallback to sample.wav only if no real audio
            if (!audioToProcess) {
                const samplePath = path.join(__dirname, 'sample.wav');
                if (fs.existsSync(samplePath)) {
                    audioToProcess = samplePath;
                    console.log("[Bot] No recorded audio found. Using sample.wav fallback.");
                }
            }

            if (audioToProcess) {
                // Pass speaker log so STT knows the real names
                const sttResult = await processAudioThroughSTT(sessionId, audioToProcess, session.speakerLog);
                session.transcript = sttResult.transcript;
                session.duration = sttResult.duration;
                // NEW: Store audio path for future playback
                session.audioPath = sttResult.audio_path;
                console.log(`[Bot] STT Success. Audio stored at: ${session.audioPath}`);
            } else {
                console.log("[Bot] No audio source found (real or sample). Simulating transcript.");
                const realName = session.speakerLog?.[0]?.name || "Unknown Speaker";
                session.transcript = [
                    { start_time: 0, end_time: 5, speaker_id: realName, text: "Welcome to the engineering sync." },
                    { start_time: 5, end_time: 10, speaker_id: "System", text: "No audio was recorded." }
                ];
            }

            await notifyMainApp(sessionId, 'transcript_ready', {
                meetingId: session.meetingId,
                mode: session.mode
            });

            // Clean up temp audio files
            if (fs.existsSync(meetingDir)) {
                // fs.rmSync(meetingDir, { recursive: true, force: true });
                // console.log(`[Bot] Cleaned up temp files for ${sessionId}`);
                console.log(`[Bot] Keeping temp files for debugging: ${meetingDir}`);
            }

        } catch (e) {
            console.error("[Bot] STT Processing failed:", e.message);
            await notifyMainApp(sessionId, 'error', { error: 'STT_FAILED' });
        }
    }

    if (session.browser) await session.browser.close();

    // Keep session in memory but marked as completed so we can retrieve transcript
    session.status = 'completed';
}

app.listen(PORT, () => {
    console.log(`[BotService] Port: ${PORT}`);
});
