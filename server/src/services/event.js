import { getDatabase } from '../config/database.js';

/**
 * Retrieves a single event by its ID.
 * @param {string} eventId - The ID of the event to retrieve.
 * @returns {Promise<object|null>} The event object or null if not found.
 */
export const getEventById = async (eventId) => {
  const db = getDatabase();
  const [rows] = await db.query('SELECT * FROM events WHERE id = ?', [eventId]);
  if (rows.length > 0) {
    // The 'ticketTiers' and 'detailedLineup' are stored as JSON strings.
    // We should parse them before returning.
    const event = rows[0];
    if (event.ticketTiers && typeof event.ticketTiers === 'string') {
      event.ticketTiers = JSON.parse(event.ticketTiers);
    }
    if (event.detailedLineup && typeof event.detailedLineup === 'string') {
      event.detailedLineup = JSON.parse(event.detailedLineup);
    }
    return event;
  }
  return null;
};
