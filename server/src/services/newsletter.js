// server/src/services/newsletter.js
import { getDatabase } from '../config/database.js';

/**
 * Subscribes an email to the newsletter.
 * If the email already exists, it reactivates the subscription.
 * @param {string} email - The email to subscribe.
 * @returns {Promise<any>} The result from the database query.
 */
export const subscribeEmail = async (email) => {
  const db = getDatabase();
  // Use ON DUPLICATE KEY UPDATE to handle existing emails gracefully (reactivates subscription).
  const query = `
    INSERT INTO newsletter_subscribers (email, is_subscribed, subscribed_at, unsubscribed_at)
    VALUES (?, TRUE, NOW(), NULL)
    ON DUPLICATE KEY UPDATE is_subscribed = TRUE, subscribed_at = NOW(), unsubscribed_at = NULL
  `;
  const [result] = await db.query(query, [email]);
  return result;
};

/**
 * Fetches all currently subscribed email addresses.
 * @returns {Promise<string[]>} An array of email strings.
 */
export const getAllSubscribers = async () => {
  const db = getDatabase();
  const query = `SELECT email FROM newsletter_subscribers WHERE is_subscribed = TRUE`;
  const [rows] = await db.query(query);
  return rows.map(row => row.email);
};

/**
 * Fetches all subscribers with their full data for the admin panel.
 * @returns {Promise<object[]>} An array of subscriber objects.
 */
export const getSubscribersForAdmin = async () => {
  const db = getDatabase();
  const query = `SELECT id, email, is_subscribed, subscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC`;
  const [rows] = await db.query(query);
  return rows;
};
