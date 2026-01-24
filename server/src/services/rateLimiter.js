/**
 * Rate Limiter Middleware
 * Provides rate limiting for API routes and Socket.io connections.
 * Implemented without external dependencies to ensure stability.
 */

const store = new Map();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (now > value.expiry) {
      store.delete(key);
    }
  }
}, 60000); // Check every minute

const createLimiter = (options) => {
  const { windowMs, max, message, prefix } = options;

  return (req, res, next) => {
    // Get IP (support proxy like Nginx/Plesk)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `${prefix}:${ip}`;
    const now = Date.now();

    let record = store.get(key);

    if (!record || now > record.expiry) {
      record = {
        count: 0,
        expiry: now + windowMs
      };
    }

    record.count++;
    store.set(key, record);

    if (record.count > max) {
      return res.status(429).json(message || { error: 'Too many requests' });
    }

    next();
  };
};

// General API Rate Limiter
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  prefix: 'api',
  message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' }
});

// Stricter Auth Rate Limiter
export const authLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  prefix: 'auth',
  message: { error: 'Zu viele Login-Versuche. Bitte versuchen Sie es später erneut.' }
});

// Socket.io Middleware
export const socketRateLimit = (socket, next) => {
  const ip = socket.handshake.address || 'unknown';
  const key = `socket:${ip}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const max = 30; // Max connection attempts per minute

  let record = store.get(key);

  if (!record || now > record.expiry) {
    record = {
      count: 0,
      expiry: now + windowMs
    };
  }

  record.count++;
  store.set(key, record);

  if (record.count > max) {
    const err = new Error('Too many connection attempts');
    err.data = { content: 'Please try again later' };
    return next(err);
  }

  next();
};