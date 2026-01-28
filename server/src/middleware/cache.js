import { get, set, invalidate } from "../services/cache.js";

/**
 * Caching Middleware
 * Supports signatures:
 * - cache(duration) -> uses req.originalUrl (minus 't' param) as key
 * - cache(keyString, duration) -> uses keyString
 * - cache(keyFunction, duration) -> uses keyFunction(req)
 */
export const cache = (arg1, arg2) => {
  let duration = 300;
  let keyGenerator = null;

  if (typeof arg1 === 'number') {
    duration = arg1;
  } else if (typeof arg1 === 'string') {
    keyGenerator = () => arg1;
    if (typeof arg2 === 'number') duration = arg2;
  } else if (typeof arg1 === 'function') {
    keyGenerator = arg1;
    if (typeof arg2 === 'number') duration = arg2;
  }

  return async (req, res, next) => {
    // Nur GET-Requests cachen
    if (req.method !== 'GET') {
      return next();
    }

    let key;
    if (keyGenerator) {
      key = keyGenerator(req);
    } else {
      // Standard: URL als Key, aber 't' Parameter entfernen (Cache-Busting vom Frontend)
      // Wir nutzen req.originalUrl damit der volle Pfad inkl. Query Params da ist
      const fullUrl = req.originalUrl || req.url;
      try {
        const urlObj = new URL(fullUrl, 'http://dummy');
        urlObj.searchParams.delete('t'); // Entferne Timestamp
        key = urlObj.pathname + urlObj.search;
      } catch (e) {
        key = fullUrl;
      }
    }

    try {
      const cachedResponse = await get(key);

      if (cachedResponse) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-Cache', 'HIT'); // Debugging Header
        return res.send(cachedResponse);
      }
    } catch (err) {
      console.error("[Cache Middleware] Error:", err);
    }

    res.setHeader('X-Cache', 'MISS');

    // Response abfangen und cachen
    const originalSend = res.send;
    res.send = function(body) {
      // Nur erfolgreiche Responses cachen
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Async set, aber wir warten nicht darauf, um den Response nicht zu verzögern
        set(key, body, duration).catch(err => 
          console.error("[Cache Middleware] Set Error:", err)
        );
      }
      return originalSend.call(this, body);
    };

    next();
  };
};

export const invalidateCache = invalidate;

export default cache;