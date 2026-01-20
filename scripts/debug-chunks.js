
import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL;
const MONGO_DB = process.env.MONGO_DB || 'meeting_ai_prod';

async function debugChunks() {
    if (!MONGO_URL) {
        console.error("Please provide MONGO_URL in .env");
        process.exit(1);
    }

    const client = new MongoClient(MONGO_URL);
    await client.connect();
    const db = client.db(MONGO_DB);
    const chunksColl = db.collection('chunks');

    // 1. Get a sample meeting ID
    const sample = await chunksColl.findOne({});
    if (!sample) {
        console.log("No chunks found in DB.");
        await client.close();
        return;
    }
    const meetingId = sample.meetingId;
    console.log(`Checking chunks for meeting: ${meetingId}`);

    // 2. Search for "Akash"
    const akashChunks = await chunksColl.find({
        meetingId: meetingId,
        text: { $regex: 'Akash', $options: 'i' }
    }).toArray();

    console.log(`Found ${akashChunks.length} chunks containing 'Akash'.`);
    akashChunks.forEach((c, i) => {
        console.log(`--- Match ${i + 1} ---`);
        console.log(c.text.substring(0, 150) + "...");
    });

    await client.close();
}

debugChunks().catch(console.error);
