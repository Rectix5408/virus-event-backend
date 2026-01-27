import NodeCache from "node-cache";

// Standard TTL: 5 Minuten, Check-Period: 1 Minute
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

export const KEYS = {
  // Wir nutzen hier die URLs als Keys, damit die Middleware sie automatisch findet
  EVENTS_ALL: "/api/events",
  EVENT_DETAIL: (id) => `/api/events/${id}`,
  MERCH_ALL: "/api/merch/products",
  MERCH_DETAIL: (id) => `/api/merch/products/${id}`,
};

export const get = (key) => {
  return cache.get(key);
};

export const set = (key, value, ttl) => {
  cache.set(key, value, ttl);
};

export const invalidate = (keys) => {
  if (!keys) return;
  
  const keysArray = Array.isArray(keys) ? keys : [keys];
  
  // Löscht exakte Matches
  cache.del(keysArray);
  
  console.log(`[Cache] Invalidated: ${keysArray.join(', ')}`);
};

export default {
  get,
  set,
  invalidate,
  KEYS
};