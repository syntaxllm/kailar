import Redis from 'ioredis';

// Use a singleton Redis client
let redis = null;

function getRedis() {
    if (!redis) {
        if (!process.env.REDIS_URL) {
            console.warn("⚠️ REDIS_URL not set. Falling back to in-memory key rotation (not persistent across restarts).");
            return null;
        }
        // Check if using TLS (rediss://)
        const isTls = process.env.REDIS_URL.startsWith('rediss://');

        redis = new Redis(process.env.REDIS_URL, {
            tls: isTls ? { rejectUnauthorized: false } : undefined, // Useful for some cloud providers
        });

        redis.on('error', (err) => {
            // Suppress connection errors to prevent app crash, just warn
            console.warn('⚠️ Redis Connection Error (Falling back to memory):', err.message);
            redis = null; // Force fallback
        });
    }
    return redis;
}

const KEYS = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "").split(',').map(k => k.trim()).filter(k => k);
const REDIS_INDEX_KEY = 'groq:active_key_index';

// Local fallback if Redis is missing
let localIndex = 0;

/**
 * Get the current active API Key
 */
export async function getActiveKey() {
    if (KEYS.length === 0) {
        throw new Error("No GROQ_API_KEYS configured.");
    }

    const client = getRedis();
    let index = 0;

    if (client) {
        try {
            const storedIndex = await client.get(REDIS_INDEX_KEY);
            index = storedIndex ? Number(storedIndex) : 0;
        } catch (e) {
            console.error("Failed to read from Redis, using local index", e);
            index = localIndex;
        }
    } else {
        index = localIndex;
    }

    // Wrap around securely
    index = index % KEYS.length;
    return KEYS[index];
}

/**
 * Rotate to the next available key
 * Call this when a 429 Rate Limit error occurs
 */
export async function rotateKey() {
    console.log(`⚠️ Rate Limit Hit! Rotating API Key... (Current Pool Size: ${KEYS.length})`);

    if (KEYS.length <= 1) {
        console.warn("⚠️ Rotation requested but only 1 key is available. Waiting won't help.");
        return KEYS[0];
    }

    const client = getRedis();

    if (client) {
        try {
            // Atomically increment the index
            const newIndex = await client.incr(REDIS_INDEX_KEY);
            return KEYS[newIndex % KEYS.length];
        } catch (e) {
            console.error("Failed to update Redis, using local rotation", e);
        }
    }

    // Fallback
    localIndex = (localIndex + 1) % KEYS.length;
    return KEYS[localIndex];
}
