import redisClient from "../config/redis.js";

// Standard TTL: 10 Minuten (da wir Invalidation haben, können wir länger cachen)
const DEFAULT_TTL = 600;

export const KEYS = {
  // Keys müssen exakt mit den in den Routen verwendeten Strings übereinstimmen
  EVENTS_ALL: "events:all",
  EVENT_DETAIL: (id) => `events:detail:${id}`,
  MERCH_ALL: "merch:products",
  MERCH_DETAIL: (id) => `merch:product:${id}`,
};

export const get = async (key) => {
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`❌ [Redis] Get Error for key ${key}:`, error.message);
    return null; // Fallback zur Datenbank
  }
};

export const set = async (key, value, ttl = DEFAULT_TTL) => {
  try {
    await redisClient.set(key, JSON.stringify(value), 'EX', ttl);
  } catch (error) {
    console.error(`❌ [Redis] Set Error for key ${key}:`, error.message);
  }
};

export const invalidate = async (keys) => {
  if (!keys) return;
  const keysArray = Array.isArray(keys) ? keys : [keys];
  if (keysArray.length === 0) return;

  try {
    await redisClient.del(keysArray);
    console.log(`🗑️ [Redis] Invalidated: ${keysArray.join(', ')}`);
  } catch (error) {
    console.error(`❌ [Redis] Invalidate Error:`, error.message);
  }
};

export default {
  get,
  set,
  invalidate,
  KEYS
};