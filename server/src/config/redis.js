import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    // Exponentieller Backoff: Warte max 2 Sekunden zwischen Versuchen
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null,
};

// Nutze REDIS_URL falls vorhanden (z.B. in Produktion), sonst Einzelwerte
const client = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL, { retryStrategy: redisConfig.retryStrategy })
  : new Redis(redisConfig);

client.on('connect', () => console.log('✅ Redis connected successfully'));
client.on('error', (err) => console.error('❌ Redis connection error:', err));
client.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));

export default client;