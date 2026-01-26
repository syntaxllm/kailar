
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URL = process.env.MONGO_URL;
const MONGO_DB = process.env.MONGO_DB || 'meeting_ai_prod';

async function seed() {
    if (!MONGO_URL) {
        console.error("❌ MONGO_URL not found in .env");
        process.exit(1);
    }

    console.log("Connecting to MongoDB...");
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    const db = client.db(MONGO_DB);

    const demoMeetingId = "demo-meeting-001";

    const demoMeeting = {
        meetingId: demoMeetingId,
        source: "Demo Upload",
        externalId: "demo-123",
        recordingUrl: null,
        importedAt: new Date().toISOString(),
        durationSeconds: 120,
        entries: [
            { id: "1", sequence: 1, start: "00:00:01", end: "00:00:05", speaker: "Sarah (Product)", text: "Okay, let's get started. Thanks for joining everyone." },
            { id: "2", sequence: 2, start: "00:00:06", end: "00:00:10", speaker: "Sarah (Product)", text: "Today we need to finalize the launch timeline for the new 'Bot Always Joins' feature." },
            { id: "3", sequence: 3, start: "00:00:11", end: "00:00:15", speaker: "Mike (Engineering)", text: "Right. The architecture is ready. We have the Hybrid Processor working." },
            { id: "4", sequence: 4, start: "00:00:16", end: "00:00:22", speaker: "Mike (Engineering)", text: "Basically, if you're an organizer, we use Graph API. If you're a guest, we spin up a bot to record." },
            { id: "5", sequence: 5, start: "00:00:23", end: "00:00:28", speaker: "Jessica (Design)", text: "That sounds robust. What about the UI? Is the dashboard ready?" },
            { id: "6", sequence: 6, start: "00:00:29", end: "00:00:35", speaker: "Sarah (Product)", text: "The UI is live on localhost:5656, but it looks a bit empty right now. We need to populate it." },
            { id: "7", sequence: 7, start: "00:00:36", end: "00:00:40", speaker: "Mike (Engineering)", text: "I can run a seed script to add some data. That way we can test the Summary and Chat features." },
            { id: "8", sequence: 8, start: "00:00:41", end: "00:00:45", speaker: "Jessica (Design)", text: "Great idea. Let's make sure the dark mode looks premium too." },
            { id: "9", sequence: 9, start: "00:00:46", end: "00:00:50", speaker: "Sarah (Product)", text: "Agreed. Let's aim to ship this by Friday. Any blockers?" },
            { id: "10", sequence: 10, start: "00:00:51", end: "00:00:55", speaker: "Mike (Engineering)", text: "No blockers. Just need to finish the integration tests." },
            { id: "11", sequence: 11, start: "00:00:56", end: "00:01:00", speaker: "Sarah (Product)", text: "Perfect. Meeting adjourned." }
        ]
    };

    // Save Transcript
    console.log(`Seeding meeting: ${demoMeetingId}`);
    await db.collection('transcripts').updateOne(
        { meetingId: demoMeetingId },
        { $set: demoMeeting },
        { upsert: true }
    );

    // Save Chunks (for Chat)
    console.log("Seeding chunks...");
    const chunks = demoMeeting.entries.map(e => ({
        chunkId: `${demoMeetingId}#${e.sequence}`,
        meetingId: demoMeetingId,
        text: `${e.speaker}: ${e.text}`,
        startTime: e.start,
        endTime: e.end
    }));

    await db.collection('chunks').deleteMany({ meetingId: demoMeetingId });
    await db.collection('chunks').insertMany(chunks);

    console.log("✅ Seed complete!");
    await client.close();
}

seed().catch(console.error);
