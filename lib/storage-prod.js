import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL;
const MONGO_DB = process.env.MONGO_DB || 'meeting_ai_prod';

let client = null;
let db = null;

async function connect() {
    if (db) return db;
    client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db(MONGO_DB);
    return db;
}

/**
 * SIMPLIFIED RAG RETRIEVAL
 * Standard Keyword Search for Production (Reliable & Cost-Free)
 */
export async function searchChunksKeyword(query, meetingId, limit = 10) {
    const database = await connect();
    const collection = database.collection('chunks');

    // Use a simple partial match (regex) for maximum reliability across all Atlas tiers
    // This requires zero manual index setup in the Atlas UI.
    const results = await collection.find({
        meetingId: meetingId,
        text: { $regex: query, $options: 'i' }
    }).limit(limit).toArray();

    return results;
}

export async function saveTranscripts(meeting) {
    const database = await connect();
    await database.collection('transcripts').updateOne(
        { meetingId: meeting.meetingId },
        { $set: meeting },
        { upsert: true }
    );
}

export async function updateMeeting(meetingId, updateData) {
    const database = await connect();
    await database.collection('transcripts').updateOne(
        { meetingId: meetingId },
        { $set: updateData }
    );
}

export async function saveChunks(chunks) {
    const database = await connect();
    if (!chunks.length) return;
    await database.collection('chunks').deleteMany({ meetingId: chunks[0].meetingId });
    await database.collection('chunks').insertMany(chunks);
}

export async function loadTranscripts() {
    const database = await connect();
    return await database.collection('transcripts').find({}).sort({ importedAt: -1 }).toArray();
}

export async function getMeeting(meetingId) {
    const database = await connect();
    return await database.collection('transcripts').findOne({ meetingId });
}

export async function loadChunks(meetingId) {
    const database = await connect();
    return await database.collection('chunks').find({ meetingId }).toArray();
}
