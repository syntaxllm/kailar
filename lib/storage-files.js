import fs from 'fs';
import path from 'path';

const TRANSCRIPTS_FILE = path.join(process.cwd(), 'data', 'transcripts.json');
const CHUNKS_FILE = path.join(process.cwd(), 'data', 'chunks.json');

const useMongo = Boolean(process.env.MONGO_URL);
let mongoClient, mongoDb, transcriptsColl, chunksColl;

async function initMongo() {
  if (!useMongo || mongoClient) return;
  const { MongoClient } = await import('mongodb');
  mongoClient = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  await mongoClient.connect();
  mongoDb = mongoClient.db(process.env.MONGO_DB || 'teams_notes');
  transcriptsColl = mongoDb.collection('meeting_transcripts');
  chunksColl = mongoDb.collection('rag_chunks');
  await transcriptsColl.createIndex({ meetingId: 1 }, { unique: true });
  await chunksColl.createIndex({ chunkId: 1 }, { unique: true });
}

export async function loadTranscripts() {
  if (useMongo) {
    await initMongo();
    return await transcriptsColl.find({}).toArray();
  }
  if (!fs.existsSync(TRANSCRIPTS_FILE)) return [];
  const raw = fs.readFileSync(TRANSCRIPTS_FILE, 'utf8');
  try { const p = JSON.parse(raw); return p.transcripts || p || []; } catch { return []; }
}

export async function loadChunks() {
  if (useMongo) {
    await initMongo();
    return await chunksColl.find({}).toArray();
  }
  if (!fs.existsSync(CHUNKS_FILE)) return [];
  const raw = fs.readFileSync(CHUNKS_FILE, 'utf8');
  try { const p = JSON.parse(raw); return p.chunks || p || []; } catch { return []; }
}

export async function saveTranscripts(transcripts) {
  if (useMongo) {
    await initMongo();
    const ops = (Array.isArray(transcripts) ? transcripts : [transcripts]).map(t => ({
      updateOne: {
        filter: { meetingId: t.meetingId },
        update: { $set: t },
        upsert: true
      }
    }));
    if (ops.length) await transcriptsColl.bulkWrite(ops);
    return;
  }
  await fs.promises.mkdir(path.dirname(TRANSCRIPTS_FILE), { recursive: true });
  const payload = Array.isArray(transcripts) ? { transcripts } : transcripts;
  await fs.promises.writeFile(TRANSCRIPTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

export async function saveChunks(chunks) {
  if (useMongo) {
    await initMongo();
    const ops = (Array.isArray(chunks) ? chunks : [chunks]).map(c => ({
      updateOne: {
        filter: { chunkId: c.chunkId },
        update: { $set: c },
        upsert: true
      }
    }));
    if (ops.length) await chunksColl.bulkWrite(ops);
    return;
  }
  await fs.promises.mkdir(path.dirname(CHUNKS_FILE), { recursive: true });
  const payload = { chunks: Array.isArray(chunks) ? chunks : [chunks] };
  await fs.promises.writeFile(CHUNKS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}
