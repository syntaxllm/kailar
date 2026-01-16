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
 * PRODUCTION RAG RETRIEVAL
 * This is the "Official" way to search in MongoDB Atlas
 */
export async function vectorSearchChunks(queryVector, meetingId, limit = 10) {
    const database = await connect();
    const collection = database.collection('chunks');

    const pipeline = [
        {
            "$vectorSearch": {
                "index": "vector_index", // This must match the index name in Atlas UI
                "path": "embedding",
                "queryVector": queryVector,
                "numCandidates": 100,
                "limit": limit,
                "filter": { "meetingId": meetingId }
            }
        },
        {
            "$project": {
                "text": 1,
                "meetingId": 1,
                "startSec": 1,
                "score": { "$meta": "vectorSearchScore" }
            }
        }
    ];

    return await collection.aggregate(pipeline).toArray();
}

export async function saveTranscripts(meeting) {
    const database = await connect();
    await database.collection('transcripts').updateOne(
        { meetingId: meeting.meetingId },
        { $set: meeting },
        { upsert: true }
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
