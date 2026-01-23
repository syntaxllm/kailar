import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

class RedisClient {
    constructor() {
        if (!REDIS_URL) {
            console.warn('⚠️ REDIS_URL not found in environment. Shared speaker status will be disabled.');
            this.client = null;
            return;
        }

        try {
            this.client = new Redis(REDIS_URL, {
                maxRetriesPerRequest: null,
                enableReadyCheck: false
            });

            this.client.on('error', (err) => {
                console.error('Redis Client Error:', err);
            });
        } catch (err) {
            console.error('Redis Initialization Failed:', err);
            this.client = null;
        }
    }

    async set(key, value, expirySeconds = 60) {
        if (!this.client) return;
        try {
            await this.client.set(key, JSON.stringify(value), 'EX', expirySeconds);
        } catch (err) {
            console.error('Redis Set Error:', err);
        }
    }

    async get(key) {
        if (!this.client) return null;
        try {
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (err) {
            console.error('Redis Get Error:', err);
            return null;
        }
    }

    async del(key) {
        if (!this.client) return;
        try {
            await this.client.del(key);
        } catch (err) {
            console.error('Redis Del Error:', err);
        }
    }
}

export const redis = new RedisClient();
