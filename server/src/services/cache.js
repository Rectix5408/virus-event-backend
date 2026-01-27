import redis from '../config/redis.js';

export const TTL_DEFAULT = 60; // 60 Sekunden Standard-Cache
export const TTL_LONG = 300;   // 5 Minuten für selten geänderte Daten

export const KEYS = {
  EVENTS_ALL: 'events:all',
  EVENT_DETAIL: (id) => `event:${id}`,
  MERCH_ALL: 'merch:products',
  MERCH_DETAIL: (id) => `merch:product:${id}`,
};

/**
 * Holt Daten aus dem Cache oder führt die fetchFunction aus und cached das Ergebnis.
 * Pattern: Cache-Aside
 */
export const getOrSet = async (key, fetchFunction, ttl = TTL_DEFAULT) => {
  try {
    const cachedData = await redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData);
    }
  } catch (err) {
    console.error(`❌ Redis Get Error (${key}):`, err);
    // Bei Redis-Fehler nicht abbrechen, sondern Fallback auf DB
  }

  // Daten aus DB holen (fetchFunction)
  const data = await fetchFunction();

  if (data) {
    try {
      // Daten im Cache speichern
      await redis.set(key, JSON.stringify(data), 'EX', ttl);
    } catch (err) {
      console.error(`❌ Redis Set Error (${key}):`, err);
    }
  }

  return data;
};

/**
 * Löscht Cache Keys (Invalidierung)
 * Akzeptiert einen einzelnen Key (String) oder ein Array von Keys.
 */
export const invalidate = async (keys) => {
  if (!keys) return;
  const keysToArray = Array.isArray(keys) ? keys : [keys];
  
  try {
    if (keysToArray.length > 0) {
      await redis.del(...keysToArray);
      console.log(`🗑️ Cache Invalidated: ${keysToArray.join(', ')}`);
    }
  } catch (err) {
    console.error('❌ Redis Invalidate Error:', err);
  }
};