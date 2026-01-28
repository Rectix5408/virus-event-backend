import { getDatabase } from "../config/database.js";
import crypto from 'crypto';
import { sendEmail } from "./email.js";
import { emitEvent } from "./socket.js";

// In-Memory Cache für Abonnenten-Liste (verhindert DB-Überlastung)
let subscribersCache = null;

export const getAllSubscribers = async () => {
  if (subscribersCache) return subscribersCache;

  const db = getDatabase();
  const [rows] = await db.query("SELECT id, email, firstName, is_subscribed, subscribed_at, unsubscribed_at, ipAddress FROM newsletter_subscribers ORDER BY subscribed_at DESC");
  subscribersCache = rows;
  return rows;
};

export const subscribe = async (email, firstName, ipAddress) => {
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    const [existing] = await connection.execute(
      "SELECT * FROM newsletter_subscribers WHERE email = ?", 
      [email]
    );

    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const unsubscribeToken = crypto.randomBytes(32).toString('hex');

    if (existing.length > 0) {
      const sub = existing[0];
      if (sub.is_subscribed) { // is_subscribed = 1 means active
        return { status: 'already_active' };
      }
      // Re-Aktivierung
      await connection.execute(
        "UPDATE newsletter_subscribers SET is_subscribed = 0, confirmationToken = ?, firstName = ? WHERE id = ?",
        [confirmationToken, firstName, sub.id]
      );
    } else {
      // Neu anlegen
      await connection.execute(
        "INSERT INTO newsletter_subscribers (email, firstName, is_subscribed, confirmationToken, unsubscribeToken, ipAddress) VALUES (?, ?, 0, ?, ?, ?)",
        [email, firstName, confirmationToken, unsubscribeToken, ipAddress]
      );
    }

    // Cache invalidieren & Live-Update senden
    subscribersCache = null;
    emitEvent('newsletter_update', { type: 'subscribers' });

    const confirmLink = `${process.env.FRONTEND_URL}/newsletter/confirm?token=${confirmationToken}`;
    await sendEmail({
      to: email,
      subject: "Bitte bestätige deine Anmeldung zum VIRUS Newsletter",
      html: `
        <h1>Willkommen bei VIRUS, ${firstName || ''}!</h1>
        <p>Bitte bestätige deine E-Mail-Adresse:</p>
        <a href="${confirmLink}" style="padding: 10px 20px; background: #000; color: #fff; text-decoration: none;">Bestätigen</a>
      `,
      text: `Bitte bestätige deine Anmeldung: ${confirmLink}`
    });

    return { status: 'pending_confirmation' };
  } finally {
    connection.release();
  }
};

export const confirmSubscription = async (token) => {
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    const [rows] = await connection.execute(
      "SELECT * FROM newsletter_subscribers WHERE confirmationToken = ? AND is_subscribed = 0",
      [token]
    );

    if (rows.length === 0) throw new Error("Ungültiger Token.");

    await connection.execute(
      "UPDATE newsletter_subscribers SET is_subscribed = 1, confirmationToken = NULL WHERE id = ?",
      [rows[0].id]
    );

    // Cache invalidieren & Live-Update senden
    subscribersCache = null;
    emitEvent('newsletter_update', { type: 'subscribers' });

    return { success: true };
  } finally {
    connection.release();
  }
};

export const unsubscribe = async (token) => {
  const db = getDatabase();
  await db.execute(
    "UPDATE newsletter_subscribers SET is_subscribed = 0, unsubscribed_at = NOW() WHERE unsubscribeToken = ?",
    [token]
  );

  // Cache invalidieren & Live-Update senden
  subscribersCache = null;
  emitEvent('newsletter_update', { type: 'subscribers' });

  return { success: true };
};