import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.MONGO_URL;
const dbName = process.env.MONGO_DB || 'meeting_ai_prod';

async function testConnection() {
    if (!url || url.includes('your_')) {
        console.error("❌ ERROR: MONGO_URL not found in .env file.");
        process.exit(1);
    }

    console.log("⏳ Connecting to MongoDB Atlas...");
    const client = new MongoClient(url);

    try {
        await client.connect();
        console.log("✅ SUCCESS: Connected to MongoDB Cluster!");

        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();
        console.log(`📂 Database: ${dbName}`);
        console.log(`📊 Existing Collections: ${collections.length ? collections.map(c => c.name).join(', ') : 'None (Ready to initialize)'}`);

    } catch (err) {
        console.error("❌ CONNECTION FAILED:", err.message);
    } finally {
        await client.close();
    }
}

testConnection();
