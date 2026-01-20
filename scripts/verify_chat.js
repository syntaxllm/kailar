
import dotenv from 'dotenv';
dotenv.config();

import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL;

async function verifyChat() {
    // Dynamic import to ensure env vars are loaded first
    const { searchChunksKeyword } = await import('../lib/storage-prod.js');
    if (!MONGO_URL) {
        console.error("❌ MONGO_URL not found in .env");
        process.exit(1);
    }

    console.log("🔍 Connecting to MongoDB...");
    const client = new MongoClient(MONGO_URL);
    await client.connect();

    // 1. Get the latest meeting ID
    const db = client.db(process.env.MONGO_DB || 'meeting_ai_prod');
    const meeting = await db.collection('transcripts').findOne({}, { sort: { importedAt: -1 } });

    if (!meeting) {
        console.log("❌ No meetings found to verify.");
        await client.close();
        return;
    }

    const meetingId = meeting.meetingId;
    console.log(`\n✅ Using Meeting ID: ${meetingId}`);

    // 2. Perform Retrieval Check for "Uday"
    const query = "What was Uday doing?";
    console.log(`\n🤖 Simulating Query: "${query}"...`);

    // Use the ACTUAL function our app uses
    const chunks = await searchChunksKeyword(query, meetingId, 5);

    console.log(`\n📄 Retrieved ${chunks.length} Chunks:`);
    chunks.forEach((c, i) => {
        console.log(`\n--- chunk ${i + 1} (Score: ${c.score || 'N/A'}) ---`);
        console.log(c.text.substring(0, 300) + "..."); // Print first 300 chars
    });

    if (chunks.length === 0) {
        console.log("\n⚠️ WARNING: No chunks returned! The Retrieval Step is failing.");
    } else {
        console.log("\n✅ Retrieval Successful. If the Chat still fails, it is an LLM Decision, not a Retrieval Bug.");
    }

    await client.close();
}

verifyChat().catch(console.error);
