import { get, set, invalidate } from "../services/cache.js";

/**
 * Caching Middleware
 * @param {number} duration - Cache duration in seconds
 */
export const cache = (duration = 300) => {
  return (req, res, next) => {
    // Nur GET-Requests cachen
    if (req.method !== 'GET') {
      return next();
    }

    // URL als Cache-Key nutzen (z.B. "/api/events")
    const key = req.originalUrl || req.url;
    const cachedResponse = get(key);

    if (cachedResponse) {
      res.setHeader('Content-Type', 'application/json');
      return res.send(cachedResponse);
    }

    // Response abfangen und cachen
    const originalSend = res.send;
    res.send = function(body) {
      set(key, body, duration);
      return originalSend.call(this, body);
    };

    next();
  };
};

export const invalidateCache = invalidate;

export default cache;